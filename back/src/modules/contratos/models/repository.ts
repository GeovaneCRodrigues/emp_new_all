import type { Knex } from 'knex'
import type { Assinatura, ContratoDoLink, DadosVenda, Empresa, EscopoContratos, LinhaContrato, StatusContrato, ViaAssinatura } from './types.js'

export type ContratoCompleto = { linha: LinhaContrato; dados: DadosVenda }

export interface ContratosRepository {
  /** Contratos do escopo, do mais novo ao mais antigo. */
  listar(escopo: EscopoContratos): Promise<LinhaContrato[]>
  /** Um contrato com tudo o que o texto usa (cliente, aparelho, parcelas). */
  obter(id: number, escopo: EscopoContratos): Promise<ContratoCompleto | null>
  obterPorVenda(vendaId: number, escopo: EscopoContratos): Promise<ContratoCompleto | null>
  /** Dados de uma venda sem contrato, para gerar (null se a venda não existe ou está fora do escopo). */
  vendaParaGerar(vendaId: number, escopo: EscopoContratos): Promise<{ dados: DadosVenda; temContrato: boolean; legado: boolean } | null>
  /** Cria o contrato da venda e põe a venda em AGUARDANDO. Se já existe, devolve o que existe (criado = false). */
  criar(vendaId: number, numero: string, versao: number, usuarioId: number): Promise<{ id: number; criado: boolean }>
  marcarEnviado(id: number, texto: string): Promise<void>
  marcarAssinado(id: number): Promise<void>
  modeloAtual(): Promise<{ versao: number; texto: string } | null>
  modelo(versao: number): Promise<string | null>
  salvarModelo(texto: string, usuarioId: number): Promise<number>
  empresa(): Promise<Empresa>
  salvarEmpresa(e: Omit<Empresa, 'temLogo'>): Promise<void>
  /** A logo (data URL PNG, JPEG ou WEBP). */
  logo(): Promise<string | null>
  salvarLogo(dataUrl: string | null): Promise<void>
  /** Guarda o hash do link (o anterior deixa de valer) e zera as tentativas de CPF. */
  gravarLink(id: number, hash: string, expiraEm: Date): Promise<void>
  porLink(hash: string): Promise<ContratoDoLink | null>
  /** Soma um erro de CPF e devolve o total. */
  contarErroDeCpf(id: number): Promise<number>
  /** Grava a assinatura e fecha o contrato. false = já tinha sido assinado (outra pessoa chegou antes). */
  assinar(id: number, a: Omit<Assinatura, 'assinadoEm'>): Promise<boolean>
  assinaturaDe(id: number): Promise<Assinatura | null>
  /** Guarda o documento criado no ZapSign e derruba o link próprio (só vale um caminho de assinatura por vez). */
  gravarZapsign(id: number, z: { token: string; signerToken: string | null; url: string | null; status: string; sandbox: boolean }): Promise<void>
  atualizarStatusZapsign(id: number, status: string): Promise<void>
  /** Fecha o contrato como assinado pelo ZapSign. false = já estava assinado. */
  assinarViaZapsign(id: number): Promise<boolean>
  porTokenZapsign(token: string): Promise<LinhaContrato | null>
}

type Linha = {
  id: number; venda_id: number; numero: string; modelo_versao: number; gerado_em: Date; enviado_em: Date | null; assinado_em: Date | null; texto_enviado: string | null
  zapsign_token: string | null; zapsign_signer_token: string | null; zapsign_url: string | null; zapsign_status: string | null; zapsign_sandbox: boolean | null; assinatura_via: ViaAssinatura | null
  cliente_nome: string; cliente_fone: string; modelo: string; gb: number; data_venda: Date | string; venda_status: string; contrato_status: StatusContrato
}
const dia = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)
const iso = (d: Date | null) => (d ? d.toISOString() : null)
const paraLinha = (l: Linha): LinhaContrato => ({
  id: l.id, vendaId: l.venda_id, numero: l.numero, status: l.contrato_status === 'ASSINADO' ? 'ASSINADO' : l.contrato_status === 'ENVIADO' ? 'ENVIADO' : 'AGUARDANDO', modeloVersao: l.modelo_versao,
  geradoEm: l.gerado_em.toISOString(), enviadoEm: iso(l.enviado_em), assinadoEm: iso(l.assinado_em), textoEnviado: l.texto_enviado, clienteNome: l.cliente_nome, clienteFone: l.cliente_fone, assinaturaVia: l.assinatura_via,
  zapsign: l.zapsign_token ? { token: l.zapsign_token, signerToken: l.zapsign_signer_token, url: l.zapsign_url, status: l.zapsign_status ?? 'pending', sandbox: l.zapsign_sandbox ?? false } : null,
  aparelho: l.gb > 0 ? `${l.modelo} ${l.gb} GB` : l.modelo, dataVenda: dia(l.data_venda), vendaStatus: l.venda_status,
})

const CHAVES: Record<Exclude<keyof Empresa, 'temLogo'>, string> = {
  nome: 'empresa_nome', cnpj: 'empresa_cnpj', endereco: 'empresa_endereco', email: 'empresa_email', atendente: 'empresa_atendente',
  telefone: 'empresa_telefone', cidade: 'empresa_cidade', uf: 'empresa_uf', pixChave: 'empresa_pix',
}

export function createContratosRepository(db: Knex): ContratosRepository {
  const base = (escopo: EscopoContratos) => {
    const q = db('contratos as ct').join('vendas as v', 'v.id', 'ct.venda_id').join('clientes as c', 'c.id', 'v.cliente_id').join('bens as b', 'b.id', 'v.bem_id')
      .select<Linha[]>('ct.*', 'c.nome as cliente_nome', 'c.fone as cliente_fone', 'b.modelo', 'b.gb', 'v.data_venda', 'v.status as venda_status', 'v.contrato_status')
    if (escopo.tipo === 'VENDEDOR') q.where((w) => w.where('v.vendedor_id', escopo.usuarioId).orWhere('c.responsavel_id', escopo.usuarioId))
    return q
  }

  async function dadosDaVenda(vendaId: number, numero: string): Promise<DadosVenda> {
    const v = await db('vendas as v').join('clientes as c', 'c.id', 'v.cliente_id').join('bens as b', 'b.id', 'v.bem_id').where('v.id', vendaId)
      .first<{
        data_venda: Date | string; entrada: string; troca_valor: string; status: string; nome: string; cpf: string | null; fone: string; email: string | null; rg: string | null
        endereco: string | null; numero: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null
        modelo: string; gb: number; cor: string; condicao: string; imei: string | null; serie: string | null
      }>(
        'v.data_venda', 'v.entrada', 'v.troca_valor', 'v.status', 'c.nome', 'c.cpf', 'c.fone', 'c.email', 'c.rg', 'c.endereco', 'c.numero', 'c.bairro', 'c.cidade', 'c.uf', 'c.cep',
        'b.modelo', 'b.gb', 'b.cor', 'b.condicao', 'b.imei', 'b.serie')
    if (!v) throw new Error('venda sumiu')
    const ps = await db('venda_parcelas').where({ venda_id: vendaId }).orderBy('numero').select<{ valor: string; vencimento: Date | string }[]>('valor', 'vencimento')
    return {
      vendaId, vendaStatus: v.status, numero, dataVenda: dia(v.data_venda),
      cliente: { nome: v.nome, cpf: v.cpf, fone: v.fone, email: v.email, rg: v.rg, endereco: v.endereco, numero: v.numero, bairro: v.bairro, cidade: v.cidade, uf: v.uf, cep: v.cep },
      aparelho: { modelo: v.modelo, gb: v.gb, cor: v.cor, condicao: v.condicao, imei: v.imei, serie: v.serie },
      entrada: Number(v.entrada), troca: Number(v.troca_valor), parcelas: ps.map((p) => ({ valor: Number(p.valor), vencimento: dia(p.vencimento) })),
    }
  }
  async function completo(l: Linha | undefined): Promise<ContratoCompleto | null> {
    if (!l) return null
    return { linha: paraLinha(l), dados: await dadosDaVenda(l.venda_id, l.numero) }
  }

  return {
    async listar(escopo) {
      return (await base(escopo).orderBy([{ column: 'v.data_venda', order: 'desc' }, { column: 'ct.id', order: 'desc' }])).map(paraLinha)
    },
    async obter(id, escopo) { return completo(await base(escopo).where('ct.id', id).first()) },
    async obterPorVenda(vendaId, escopo) { return completo(await base(escopo).where('ct.venda_id', vendaId).first()) },

    async vendaParaGerar(vendaId, escopo) {
      const q = db('vendas as v').join('clientes as c', 'c.id', 'v.cliente_id').where('v.id', vendaId)
      if (escopo.tipo === 'VENDEDOR') q.where((w) => w.where('v.vendedor_id', escopo.usuarioId).orWhere('c.responsavel_id', escopo.usuarioId))
      const v = await q.first<{ data_venda: Date | string; legacy_id: number | null } | undefined>('v.data_venda', 'v.legacy_id')
      if (!v) return null
      const numero = `${dia(v.data_venda).slice(0, 4)}-${String(vendaId).padStart(4, '0')}`
      return { dados: await dadosDaVenda(vendaId, numero), temContrato: !!(await db('contratos').where({ venda_id: vendaId }).first('id')), legado: v.legacy_id !== null }
    },

    async criar(vendaId, numero, versao, usuarioId) {
      return db.transaction(async (trx) => {
        const [novo] = await trx('contratos').insert({ venda_id: vendaId, numero, modelo_versao: versao, criado_por: usuarioId }).onConflict('venda_id').ignore().returning('id')
        if (!novo) return { id: (await trx('contratos').where({ venda_id: vendaId }).first<{ id: number }>('id'))!.id, criado: false }
        await trx('vendas').where({ id: vendaId }).update({ contrato_status: 'AGUARDANDO', updated_at: trx.fn.now() })
        return { id: novo.id, criado: true }
      })
    },
    async marcarEnviado(id, texto) {
      await db.transaction(async (trx) => {
        const [c] = await trx('contratos').where({ id }).update({ enviado_em: trx.fn.now(), texto_enviado: texto }).returning('venda_id')
        await trx('vendas').where({ id: c.venda_id }).update({ contrato_status: 'ENVIADO', updated_at: trx.fn.now() })
      })
    },
    async marcarAssinado(id) {
      await db.transaction(async (trx) => {
        const [c] = await trx('contratos').where({ id }).update({ assinado_em: trx.fn.now(), assinatura_via: 'MANUAL' }).returning('venda_id')
        await trx('vendas').where({ id: c.venda_id }).update({ contrato_status: 'ASSINADO', updated_at: trx.fn.now() })
      })
    },

    async modeloAtual() {
      const l = await db('contrato_modelos').orderBy('versao', 'desc').first<{ versao: number; texto: string }>('versao', 'texto')
      return l ?? null
    },
    async modelo(versao) { return (await db('contrato_modelos').where({ versao }).first<{ texto: string }>('texto'))?.texto ?? null },
    async salvarModelo(texto, usuarioId) {
      return db.transaction(async (trx) => {
        await trx.raw('select pg_advisory_xact_lock(7003)')
        const m = await trx('contrato_modelos').max({ v: 'versao' }).first<{ v: number | null }>()
        const versao = (m?.v ?? 0) + 1
        await trx('contrato_modelos').insert({ versao, texto, criado_por: usuarioId })
        return versao
      })
    },

    async empresa() {
      const ls = await db('sistema_config').whereIn('chave', Object.values(CHAVES)).select<{ chave: string; valor: unknown }[]>('chave', 'valor')
      const v = (k: keyof typeof CHAVES) => ls.find((l) => l.chave === CHAVES[k])?.valor
      const txt = (k: keyof typeof CHAVES) => { const x = v(k); return typeof x === 'string' && x.trim() ? x : null }
      const num = (k: keyof typeof CHAVES) => { const x = v(k); return typeof x === 'number' && Number.isFinite(x) ? x : null }
      const temLogo = !!(await db('sistema_config').where({ chave: 'empresa_logo' }).first('chave'))
      return {
        nome: txt('nome') ?? 'Mundo dos iPhones', cnpj: txt('cnpj'), endereco: txt('endereco'), email: txt('email'), atendente: txt('atendente'),
        telefone: txt('telefone'), cidade: txt('cidade'), uf: txt('uf'), pixChave: txt('pixChave'), temLogo,
      }
    },
    async gravarLink(id, hash, expiraEm) {
      await db('contratos').where({ id }).update({ link_hash: hash, link_expira_em: expiraEm, link_tentativas: 0 })
    },
    async porLink(hash) {
      const l = await base({ tipo: 'TODOS' }).select('c.cpf as cliente_cpf', 'ct.link_expira_em', 'ct.link_tentativas').where('ct.link_hash', hash).first<Linha & { cliente_cpf: string | null; link_expira_em: Date | null; link_tentativas: number } | undefined>()
      if (!l) return null
      return { linha: paraLinha(l), cpf: l.cliente_cpf, expiraEm: l.link_expira_em, tentativas: l.link_tentativas }
    },
    async contarErroDeCpf(id) {
      const [r] = await db('contratos').where({ id }).increment('link_tentativas', 1).returning('link_tentativas')
      return r.link_tentativas as number
    },
    async assinar(id, a) {
      return db.transaction(async (trx) => {
        const [c] = await trx('contratos').where({ id }).whereNull('assinado_em').update({ assinado_em: trx.fn.now(), assinatura_via: 'LINK', link_hash: null, link_expira_em: null }).returning('venda_id')
        if (!c) return false
        await trx('contrato_assinaturas').insert({ contrato_id: id, imagem: a.imagem, cpf: a.cpf, texto_hash: a.textoHash, ip: a.ip, user_agent: a.userAgent })
        await trx('vendas').where({ id: c.venda_id }).update({ contrato_status: 'ASSINADO', updated_at: trx.fn.now() })
        return true
      })
    },
    async assinaturaDe(id) {
      const l = await db('contrato_assinaturas').where({ contrato_id: id }).first<{ imagem: string; cpf: string; texto_hash: string; ip: string | null; user_agent: string | null; assinado_em: Date } | undefined>()
      return l ? { imagem: l.imagem, cpf: l.cpf, textoHash: l.texto_hash, ip: l.ip, userAgent: l.user_agent, assinadoEm: l.assinado_em.toISOString() } : null
    },

    async gravarZapsign(id, z) {
      await db('contratos').where({ id }).update({ zapsign_token: z.token, zapsign_signer_token: z.signerToken, zapsign_url: z.url, zapsign_status: z.status, zapsign_sandbox: z.sandbox, link_hash: null, link_expira_em: null })
    },
    async atualizarStatusZapsign(id, status) { await db('contratos').where({ id }).update({ zapsign_status: status }) },
    async assinarViaZapsign(id) {
      return db.transaction(async (trx) => {
        const [c] = await trx('contratos').where({ id }).whereNull('assinado_em').update({ assinado_em: trx.fn.now(), assinatura_via: 'ZAPSIGN', zapsign_status: 'signed', link_hash: null, link_expira_em: null }).returning('venda_id')
        if (!c) return false
        await trx('vendas').where({ id: c.venda_id }).update({ contrato_status: 'ASSINADO', updated_at: trx.fn.now() })
        return true
      })
    },
    async porTokenZapsign(token) {
      const l = await base({ tipo: 'TODOS' }).where('ct.zapsign_token', token).first<Linha | undefined>()
      return l ? paraLinha(l) : null
    },

    async salvarEmpresa(e) {
      await db('sistema_config').insert((Object.keys(CHAVES) as (keyof typeof CHAVES)[]).map((k) => ({ chave: CHAVES[k], valor: JSON.stringify(e[k]) })))
        .onConflict('chave').merge({ valor: db.raw('excluded.valor'), updated_at: db.fn.now() })
    },
    async logo() {
      const l = await db('sistema_config').where({ chave: 'empresa_logo' }).first<{ valor: unknown } | undefined>('valor')
      return typeof l?.valor === 'string' ? l.valor : null
    },
    async salvarLogo(dataUrl) {
      if (dataUrl === null) { await db('sistema_config').where({ chave: 'empresa_logo' }).del(); return }
      await db('sistema_config').insert({ chave: 'empresa_logo', valor: JSON.stringify(dataUrl) }).onConflict('chave').merge({ valor: db.raw('excluded.valor'), updated_at: db.fn.now() })
    },
  }
}
