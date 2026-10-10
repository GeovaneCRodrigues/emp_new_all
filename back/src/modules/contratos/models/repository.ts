import type { Knex } from 'knex'
import type { DadosVenda, Empresa, EscopoContratos, LinhaContrato, StatusContrato } from './types.js'

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
  definirSeguro(id: number, seguro: boolean): Promise<void>
  modeloAtual(): Promise<{ versao: number; texto: string } | null>
  modelo(versao: number): Promise<string | null>
  salvarModelo(texto: string, usuarioId: number): Promise<number>
  empresa(): Promise<Empresa>
  salvarEmpresa(e: Empresa): Promise<void>
}

type Linha = {
  id: number; venda_id: number; numero: string; modelo_versao: number; seguro: boolean; gerado_em: Date; enviado_em: Date | null; assinado_em: Date | null; texto_enviado: string | null
  cliente_nome: string; modelo: string; gb: number; data_venda: Date | string; venda_status: string; contrato_status: StatusContrato
}
const dia = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)
const iso = (d: Date | null) => (d ? d.toISOString() : null)
const paraLinha = (l: Linha): LinhaContrato => ({
  id: l.id, vendaId: l.venda_id, numero: l.numero, status: l.contrato_status === 'ASSINADO' ? 'ASSINADO' : l.contrato_status === 'ENVIADO' ? 'ENVIADO' : 'AGUARDANDO', modeloVersao: l.modelo_versao, seguro: l.seguro,
  geradoEm: l.gerado_em.toISOString(), enviadoEm: iso(l.enviado_em), assinadoEm: iso(l.assinado_em), textoEnviado: l.texto_enviado, clienteNome: l.cliente_nome,
  aparelho: l.gb > 0 ? `${l.modelo} ${l.gb} GB` : l.modelo, dataVenda: dia(l.data_venda), vendaStatus: l.venda_status,
})

const CHAVES: Record<keyof Empresa, string> = {
  nome: 'empresa_nome', cnpj: 'empresa_cnpj', endereco: 'empresa_endereco', email: 'empresa_email', atendente: 'empresa_atendente',
  avaria: 'taxa_avaria', reposicao: 'taxa_reposicao', seguro: 'taxa_seguro_mensal', cancelamentoPct: 'taxa_cancelamento_pct', recuperacao: 'taxa_recuperacao',
}

export function createContratosRepository(db: Knex): ContratosRepository {
  const base = (escopo: EscopoContratos) => {
    const q = db('contratos as ct').join('vendas as v', 'v.id', 'ct.venda_id').join('clientes as c', 'c.id', 'v.cliente_id').join('bens as b', 'b.id', 'v.bem_id')
      .select<Linha[]>('ct.*', 'c.nome as cliente_nome', 'b.modelo', 'b.gb', 'v.data_venda', 'v.status as venda_status', 'v.contrato_status')
    if (escopo.tipo === 'VENDEDOR') q.where((w) => w.where('v.vendedor_id', escopo.usuarioId).orWhere('c.responsavel_id', escopo.usuarioId))
    return q
  }

  async function dadosDaVenda(vendaId: number, numero: string, seguro: boolean): Promise<DadosVenda> {
    const v = await db('vendas as v').join('clientes as c', 'c.id', 'v.cliente_id').join('bens as b', 'b.id', 'v.bem_id').where('v.id', vendaId)
      .first<{ data_venda: Date | string; entrada: string; troca_valor: string; status: string; nome: string; cpf: string | null; fone: string; endereco: string | null; modelo: string; gb: number; cor: string; condicao: string; imei: string | null }>(
        'v.data_venda', 'v.entrada', 'v.troca_valor', 'v.status', 'c.nome', 'c.cpf', 'c.fone', 'c.endereco', 'b.modelo', 'b.gb', 'b.cor', 'b.condicao', 'b.imei')
    if (!v) throw new Error('venda sumiu')
    const ps = await db('venda_parcelas').where({ venda_id: vendaId }).orderBy('numero').select<{ valor: string; vencimento: Date | string }[]>('valor', 'vencimento')
    return {
      vendaId, vendaStatus: v.status, numero, dataVenda: dia(v.data_venda),
      cliente: { nome: v.nome, cpf: v.cpf, fone: v.fone, endereco: v.endereco }, aparelho: { modelo: v.modelo, gb: v.gb, cor: v.cor, condicao: v.condicao, imei: v.imei },
      entrada: Number(v.entrada), troca: Number(v.troca_valor), parcelas: ps.map((p) => ({ valor: Number(p.valor), vencimento: dia(p.vencimento) })), seguro,
    }
  }
  async function completo(l: Linha | undefined): Promise<ContratoCompleto | null> {
    if (!l) return null
    return { linha: paraLinha(l), dados: await dadosDaVenda(l.venda_id, l.numero, l.seguro) }
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
      return { dados: await dadosDaVenda(vendaId, numero, false), temContrato: !!(await db('contratos').where({ venda_id: vendaId }).first('id')), legado: v.legacy_id !== null }
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
        const [c] = await trx('contratos').where({ id }).update({ assinado_em: trx.fn.now() }).returning('venda_id')
        await trx('vendas').where({ id: c.venda_id }).update({ contrato_status: 'ASSINADO', updated_at: trx.fn.now() })
      })
    },
    async definirSeguro(id, seguro) { await db('contratos').where({ id }).update({ seguro }) },

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
      const v = (k: keyof Empresa) => ls.find((l) => l.chave === CHAVES[k])?.valor
      const txt = (k: keyof Empresa) => { const x = v(k); return typeof x === 'string' && x.trim() ? x : null }
      const num = (k: keyof Empresa) => { const x = v(k); return typeof x === 'number' && Number.isFinite(x) ? x : null }
      return {
        nome: txt('nome') ?? 'Mundo dos iPhones', cnpj: txt('cnpj'), endereco: txt('endereco'), email: txt('email'), atendente: txt('atendente'),
        avaria: num('avaria'), reposicao: num('reposicao'), seguro: num('seguro'), cancelamentoPct: num('cancelamentoPct'), recuperacao: num('recuperacao'),
      }
    },
    async salvarEmpresa(e) {
      await db('sistema_config').insert((Object.keys(CHAVES) as (keyof Empresa)[]).map((k) => ({ chave: CHAVES[k], valor: JSON.stringify(e[k]) })))
        .onConflict('chave').merge({ valor: db.raw('excluded.valor'), updated_at: db.fn.now() })
    },
  }
}
