import { camposDesconhecidos, MODELO_PADRAO, preencher, VARIAVEIS, type DadosVenda, type Empresa } from '@/domain/contrato'
import type { Sessao } from '@/domain/escopo'
import { ErroApi } from './clientes'
import type { ClientesApi } from './clientes'
import type { ViaAssinaturaApi, AssinarPublicoApi, AssinaturaContratoApi, ContratoDetalheApi, ContratoItemApi, ContratosApi, EmpresaApi, ListaContratosApi, ModeloApi, StatusContratoApi } from './contratos'
import type { EstoqueApi } from './estoque'
import type { Registro, VendasFake } from './vendas.fake'

const ADM: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const TEXTO_MIN = 50
const TEXTO_MAX = 30_000
const DINHEIRO_MAX = 1_000_000
const erro = (m: string) => new ErroApi(400, m)
const conflito = (m: string, codigo: string) => new ErroApi(409, m, codigo)
const semPermissao = (m: string) => new ErroApi(403, m, 'SEM_PERMISSAO')

type Estado = {
  modeloVersao: number; seguro: boolean; enviadoEm: string | null; assinadoEm: string | null; textoEnviado: string | null
  assinatura?: AssinaturaContratoApi
  via?: ViaAssinaturaApi
  zapsign?: { token: string; url: string; status: string }
  link?: { token: string; expiraEm: string; tentativas: number }
}
const LINK_DIAS = 7
const TENTATIVAS_DE_CPF = 5
const PNG_URL = 'data:image/png;base64,'
/** A página pública não mostra o CPF (é o que o cliente digita para provar quem é). */
function mascararCpf(texto: string, cpf: string | null): string {
  const dig = (cpf ?? '').replace(/\D/g, '')
  if (dig.length !== 11) return texto
  const mascarado = `***.***.***-${dig.slice(9)}`
  return texto.replaceAll(`${dig.slice(0, 3)}.${dig.slice(3, 6)}.${dig.slice(6, 9)}-${dig.slice(9)}`, mascarado).replaceAll(dig, mascarado)
}

/**
 * Versão de demonstração: as mesmas regras do backend. Cada venda da demonstração tem um contrato (as seedadas assinadas já vêm assinadas),
 * e o status acompanha o da venda para o resto das telas (cartões, Início do vendedor) ficarem iguais.
 */
export function criarContratosFake(dep: { vendas: VendasFake; clientes: ClientesApi; estoque: EstoqueApi }): ContratosApi & { publico: AssinarPublicoApi } {
  const hoje = dep.vendas._interno.hoje
  const agora = `${hoje}T12:00:00.000Z`
  const estados = new Map<number, Estado>()
  const modelos: { versao: number; texto: string }[] = []
  // a demonstração já vem com a empresa preenchida (no sistema de verdade começa vazia)
  let empresa: Empresa = { nome: 'Mundo dos iPhones LTDA', cnpj: '11.222.333/0001-81', endereco: 'Rua de Exemplo, 100 - Centro, São Paulo - SP', email: 'contato@exemplo.com.br', atendente: 'Geovane', avaria: 350, reposicao: 1500, seguro: 39.9, cancelamentoPct: 20, recuperacao: 250 }

  const exigirAdmin = (s: Sessao, m: string) => { if (s.perfil !== 'ADMIN') throw semPermissao(m) }
  /** Contrato de venda nova nasce com a versão do modelo que valia na hora (como o backend, que gera na venda). */
  function sincronizar() {
    for (const r of dep.vendas._interno.registros) {
      if (r.contrato === 'AGUARDANDO' && !estados.has(r.id)) estados.set(r.id, { modeloVersao: modelos.at(-1)?.versao ?? 0, seguro: false, enviadoEm: null, assinadoEm: null, textoEnviado: null })
    }
  }
  function registrosDe(s: Sessao): Registro[] {
    sincronizar()
    if (s.perfil !== 'ADMIN' && s.perfil !== 'VENDEDOR') throw semPermissao('Você não tem acesso aos contratos')
    return dep.vendas._interno.registros.filter((r) => r.contrato !== 'SEM_CONTRATO' && (s.perfil === 'ADMIN' || dep.vendas._interno.noEscopo(s).includes(r)))
  }
  const numero = (r: Registro) => `${r.dataVenda.slice(0, 4)}-${String(r.id).padStart(4, '0')}`
  const textoVersao = (v: number) => (v > 0 ? modelos.find((m) => m.versao === v)?.texto : undefined) ?? MODELO_PADRAO
  const statusDe = (r: Registro): StatusContratoApi => (r.contrato === 'ASSINADO' ? 'ASSINADO' : r.contrato === 'ENVIADO' ? 'ENVIADO' : 'AGUARDANDO')

  async function dados(r: Registro, seguro: boolean): Promise<DadosVenda> {
    const c = await dep.clientes.obter(ADM, r.cliente.id)
    const a = await dep.estoque.obter(ADM, r.aparelho.id).catch(() => null)
    return {
      vendaId: r.id, vendaStatus: r.status, numero: numero(r), dataVenda: r.dataVenda,
      cliente: {
        nome: c.nome, cpf: c.cpf ?? null, fone: c.fone, email: c.email ?? null, rg: c.rg ?? null,
        endereco: c.endereco ?? null, numero: c.numero ?? null, bairro: c.bairro ?? null, cidade: c.cidade ?? null, uf: c.uf ?? null, cep: c.cep ?? null,
      },
      aparelho: { modelo: r.aparelho.modelo, gb: r.aparelho.gb, cor: r.aparelho.cor, condicao: a?.condicao ?? 'Seminovo', imei: a?.imei ?? null, serie: a?.serie ?? null },
      entrada: r.entrada, troca: r.troca, parcelas: r.parcelas.map((p) => ({ valor: p.valor, vencimento: p.vencimento })), seguro,
    }
  }
  async function estadoDe(r: Registro): Promise<Estado> {
    let e = estados.get(r.id)
    if (!e) {
      e = { modeloVersao: 0, seguro: false, enviadoEm: null, assinadoEm: null, textoEnviado: null }
      estados.set(r.id, e)
      // contrato que a demonstração já traz enviado ou assinado: o texto já está fechado
      if (r.contrato === 'ENVIADO' || r.contrato === 'ASSINADO') {
        e.enviadoEm = `${r.dataVenda}T12:00:00.000Z`; e.textoEnviado = preencher(MODELO_PADRAO, await dados(r, false), empresa).texto
        if (r.contrato === 'ASSINADO') e.assinadoEm = `${r.dataVenda}T12:00:00.000Z`
      }
    }
    return e
  }
  async function item(r: Registro): Promise<ContratoItemApi> {
    const e = await estadoDe(r)
    return {
      id: r.id, vendaId: r.id, numero: numero(r), status: statusDe(r), modeloVersao: e.modeloVersao, seguro: e.seguro, geradoEm: `${r.dataVenda}T12:00:00.000Z`, enviadoEm: e.enviadoEm, assinadoEm: e.assinadoEm,
      clienteNome: r.cliente.nome, clienteFone: (await dep.clientes.obter(ADM, r.cliente.id)).fone, aparelho: r.aparelho.gb > 0 ? `${r.aparelho.modelo} ${r.aparelho.gb} GB` : r.aparelho.modelo, dataVenda: r.dataVenda, vendaStatus: r.status,
    }
  }
  async function detalhe(r: Registro): Promise<ContratoDetalheApi> {
    const e = await estadoDe(r)
    const contrato = await item(r)
    const extra = { assinatura: e.assinatura ?? null, assinaturaVia: e.via ?? (e.assinadoEm ? ('MANUAL' as const) : null), zapsign: e.zapsign ? { status: e.zapsign.status, sandbox: true, signUrl: e.zapsign.url, arquivoAssinado: null } : null }
    if (e.textoEnviado !== null) return { contrato, congelado: true, trechos: [{ tipo: 'txt', v: e.textoEnviado }], faltam: [], texto: e.textoEnviado, ...extra }
    const p = preencher(textoVersao(e.modeloVersao), await dados(r, e.seguro), empresa)
    return { contrato, congelado: false, trechos: p.trechos, faltam: p.faltam, texto: p.texto, ...extra }
  }
  function achar(s: Sessao, id: number): Registro {
    const r = registrosDe(s).find((x) => x.id === id)
    if (!r) throw new ErroApi(404, 'Contrato não encontrado', 'NAO_ENCONTRADO')
    return r
  }
  const ativa = (r: Registro) => r.status === 'ATIVA' || r.status === 'QUITADA'
  const pendente = (r: Registro) => r.contrato !== 'ASSINADO' && r.status !== 'RETOMADA'
  const viewModelo = (): ModeloApi => { const m = modelos.at(-1); return { versao: m?.versao ?? 0, texto: m?.texto ?? MODELO_PADRAO, padrao: MODELO_PADRAO, variaveis: VARIAVEIS } }

  let seqToken = 0
  /** O contrato de um link que ainda vale (não assinado, não vencido, não bloqueado), como o backend. */
  async function linkVivo(token: string) {
    sincronizar()
    const r = dep.vendas._interno.registros.find((x) => estados.get(x.id)?.link?.token === token)
    const e = r && estados.get(r.id)
    if (!r || !e || !e.link || e.textoEnviado === null) throw new ErroApi(404, 'Link inválido. Peça um novo ao vendedor.', 'NAO_ENCONTRADO')
    if (statusDe(r) === 'ASSINADO') throw new ErroApi(410, 'Este contrato já foi assinado.', 'CONTRATO_JA_ASSINADO')
    if (e.link.tentativas >= TENTATIVAS_DE_CPF) throw new ErroApi(410, 'Link bloqueado por tentativas erradas. Peça um novo ao vendedor.', 'LINK_BLOQUEADO')
    if (Date.parse(e.link.expiraEm) < Date.parse(agora)) throw new ErroApi(410, 'Este link venceu. Peça um novo ao vendedor.', 'LINK_VENCIDO')
    if (!ativa(r)) throw new ErroApi(410, 'Esta venda foi encerrada.', 'VENDA_ENCERRADA')
    return { r, e, link: e.link, texto: e.textoEnviado, cpf: (await dados(r, e.seguro)).cliente.cpf }
  }
  const publico: AssinarPublicoApi = {
    async ver(token) {
      const { r, link, texto, cpf } = await linkVivo(token)
      return { numero: numero(r), clienteNome: r.cliente.nome, aparelho: r.aparelho.gb > 0 ? `${r.aparelho.modelo} ${r.aparelho.gb} GB` : r.aparelho.modelo, empresa: empresa.nome, texto: mascararCpf(texto, cpf), expiraEm: link.expiraEm }
    },
    async assinar(token, corpo) {
      const { r, e, link, texto, cpf } = await linkVivo(token)
      if (corpo.aceito !== true) throw erro('Marque que leu e concorda com o contrato')
      const dig = typeof corpo.cpf === 'string' ? corpo.cpf.replace(/\D/g, '') : ''
      if (dig.length !== 11) throw erro('Digite o CPF completo (11 números)')
      if (typeof corpo.assinatura !== 'string' || !corpo.assinatura.startsWith(PNG_URL) || corpo.assinatura.length > 400_000) throw erro('Assinatura inválida. Desenhe de novo.')
      if (dig !== (cpf ?? '').replace(/\D/g, '')) {
        link.tentativas += 1
        const restam = Math.max(0, TENTATIVAS_DE_CPF - link.tentativas)
        throw new ErroApi(403, restam > 0 ? `CPF não confere. Você tem mais ${restam} ${restam === 1 ? 'tentativa' : 'tentativas'}.` : 'CPF não confere e o link foi bloqueado. Peça um novo ao vendedor.', 'CPF_NAO_CONFERE')
      }
      e.assinadoEm = agora; e.via = 'LINK'; r.contrato = 'ASSINADO'; delete e.link
      e.assinatura = { imagem: corpo.assinatura, cpf: dig, textoHash: `demo-${texto.length}`, ip: '127.0.0.1', userAgent: 'demonstração', assinadoEm: agora }
      return { numero: numero(r), assinadoEm: agora }
    },
  }

  const api: ContratosApi = {
    async listar(s, q = {}): Promise<ListaContratosApi> {
      if (q.status !== undefined && q.status !== 'ESPERANDO' && q.status !== 'ASSINADO') throw erro('status deve ser ESPERANDO ou ASSINADO')
      const todos = registrosDe(s).slice().sort((a, b) => b.dataVenda.localeCompare(a.dataVenda) || b.id - a.id)
      const itens = await Promise.all(todos.map(item))
      const filtra = (r: Registro) => (q.status === 'ASSINADO' ? r.contrato === 'ASSINADO' : q.status === 'ESPERANDO' ? pendente(r) : true)
      return {
        itens: itens.filter((_, i) => filtra(todos[i])),
        resumo: { assinados: todos.filter((r) => r.contrato === 'ASSINADO').length, esperando: todos.filter(pendente).length, comSeguro: itens.filter((i) => i.seguro).length },
      }
    },
    async obter(s, id) { return detalhe(achar(s, id)) },
    async porVenda(s, vendaId) {
      const r = registrosDe(s).find((x) => x.id === vendaId)
      if (!r) throw new ErroApi(404, 'Esta venda não tem contrato', 'NAO_ENCONTRADO')
      return detalhe(r)
    },
    async gerar(s, vendaId) {
      if (s.perfil !== 'ADMIN' && s.perfil !== 'VENDEDOR') throw semPermissao('Você não tem acesso aos contratos')
      const r = dep.vendas._interno.registros.find((x) => x.id === vendaId && (s.perfil === 'ADMIN' || dep.vendas._interno.noEscopo(s).includes(x)))
      if (!r) throw new ErroApi(404, 'Venda não encontrada', 'NAO_ENCONTRADO')
      if (r.contrato !== 'SEM_CONTRATO') throw conflito('Esta venda já tem contrato', 'CONTRATO_JA_EXISTE')
      if (!ativa(r)) throw conflito('Venda retomada ou cancelada não tem contrato', 'VENDA_ENCERRADA')
      r.contrato = 'AGUARDANDO'
      estados.set(r.id, { modeloVersao: modelos.at(-1)?.versao ?? 0, seguro: false, enviadoEm: null, assinadoEm: null, textoEnviado: null })
      return detalhe(r)
    },
    async marcarEnviado(s, id) {
      const r = achar(s, id); const e = await estadoDe(r)
      if (statusDe(r) !== 'AGUARDANDO') throw conflito(statusDe(r) === 'ASSINADO' ? 'Este contrato já foi assinado' : 'Este contrato já foi marcado como enviado', 'CONTRATO_JA_ENVIADO')
      if (!ativa(r)) throw conflito('Venda retomada ou cancelada não envia contrato', 'VENDA_ENCERRADA')
      const d = await detalhe(r)
      if (d.faltam.length) throw conflito(`Falta cadastrar: ${d.faltam.join(', ')}`, 'DADOS_FALTANDO')
      e.enviadoEm = agora; e.textoEnviado = d.texto; r.contrato = 'ENVIADO'
      return detalhe(r)
    },
    async marcarAssinado(s, id) {
      exigirAdmin(s, 'Só o administrador marca o contrato como assinado')
      const r = achar(s, id); const e = await estadoDe(r)
      if (statusDe(r) === 'ASSINADO') throw conflito('Este contrato já foi assinado', 'CONTRATO_JA_ASSINADO')
      if (statusDe(r) !== 'ENVIADO') throw conflito('Marque o contrato como enviado antes de marcar como assinado', 'CONTRATO_NAO_ENVIADO')
      e.assinadoEm = agora; e.via = 'MANUAL'; r.contrato = 'ASSINADO'
      return detalhe(r)
    },
    async zapsignStatus(s) { registrosDe(s); return { ativo: true, sandbox: true, webhook: true } },
    async enviarZapsign(s, id) {
      const r = achar(s, id); const e = await estadoDe(r)
      if (statusDe(r) === 'ASSINADO') throw conflito('Este contrato já foi assinado', 'CONTRATO_JA_ASSINADO')
      if (!ativa(r)) throw conflito('Venda retomada ou cancelada não envia contrato', 'VENDA_ENCERRADA')
      if (e.zapsign?.status === 'pending') return detalhe(r)
      const det = await detalhe(r)
      const faltam = [...det.faltam]
      const cpf = (await dados(r, e.seguro)).cliente.cpf
      if ((cpf ?? '').replace(/\D/g, '').length !== 11 && !faltam.includes('CPF')) faltam.push('CPF')
      if (faltam.length) throw conflito(`Falta cadastrar: ${faltam.join(', ')}`, 'DADOS_FALTANDO')
      if (statusDe(r) === 'AGUARDANDO') { e.enviadoEm = agora; e.textoEnviado = det.texto; r.contrato = 'ENVIADO' }
      delete e.link
      e.zapsign = { token: `demoz${++seqToken}`, url: `https://app.zapsign.com.br/verificar/demo-${seqToken}`, status: 'pending' }
      return detalhe(r)
    },
    async atualizarZapsign(s, id) {
      const r = achar(s, id); const e = await estadoDe(r)
      if (!e.zapsign) throw conflito('Este contrato não foi enviado pelo ZapSign', 'ZAPSIGN_NAO_ENVIADO')
      return detalhe(r)
    },
    async gerarLink(s, id) {
      const r = achar(s, id); const e = await estadoDe(r)
      if (e.zapsign?.status === 'pending') throw conflito('Este contrato já foi enviado pelo ZapSign e espera a assinatura de lá', 'ZAPSIGN_EM_ANDAMENTO')
      if (statusDe(r) === 'ASSINADO') throw conflito('Este contrato já foi assinado', 'CONTRATO_JA_ASSINADO')
      if (!ativa(r)) throw conflito('Venda retomada ou cancelada não envia contrato', 'VENDA_ENCERRADA')
      const det = await detalhe(r)
      const faltam = [...det.faltam]
      const cpf = (await dados(r, e.seguro)).cliente.cpf
      if ((cpf ?? '').replace(/\D/g, '').length !== 11 && !faltam.includes('CPF')) faltam.push('CPF')
      if (faltam.length) throw conflito(`Falta cadastrar: ${faltam.join(', ')}`, 'DADOS_FALTANDO')
      if (statusDe(r) === 'AGUARDANDO') { e.enviadoEm = agora; e.textoEnviado = det.texto; r.contrato = 'ENVIADO' }
      const token = `demo${String(++seqToken).padStart(4, '0')}${'x'.repeat(40)}`
      const expiraEm = new Date(Date.parse(agora) + LINK_DIAS * 86_400_000).toISOString()
      e.link = { token, expiraEm, tentativas: 0 }
      return { token, expiraEm, contrato: await detalhe(r) }
    },
    async definirSeguro(s, id, seguro) {
      exigirAdmin(s, 'Só o administrador muda o seguro do contrato')
      if (typeof seguro !== 'boolean') throw erro('seguro precisa ser verdadeiro ou falso')
      const r = achar(s, id); const e = await estadoDe(r)
      if (statusDe(r) !== 'AGUARDANDO') throw conflito('O contrato já foi enviado: o seguro não muda mais', 'CONTRATO_JA_ENVIADO')
      e.seguro = seguro
      return detalhe(r)
    },

    async modelo(s) { exigirAdmin(s, 'Só o administrador vê o modelo do contrato'); return viewModelo() },
    async salvarModelo(s, texto) {
      exigirAdmin(s, 'Só o administrador muda o modelo do contrato')
      if (typeof texto !== 'string') throw erro('texto precisa ser um texto')
      sincronizar()
      const t = texto.replace(/\r\n/g, '\n').trim()
      if (t.length < TEXTO_MIN) throw erro(`O modelo precisa ter pelo menos ${TEXTO_MIN} letras`)
      if (t.length > TEXTO_MAX) throw erro(`O modelo passa de ${TEXTO_MAX} letras`)
      const desc = camposDesconhecidos(t)
      if (desc.length) throw erro(`Campo que não existe: ${desc.map((k) => `{{${k}}}`).join(', ')}`)
      if ((modelos.at(-1)?.texto ?? MODELO_PADRAO) !== t) modelos.push({ versao: (modelos.at(-1)?.versao ?? 0) + 1, texto: t })
      return viewModelo()
    },
    async previa(s, texto, vendaId) {
      exigirAdmin(s, 'Só o administrador vê a prévia do modelo')
      if (typeof texto !== 'string' || texto.length > TEXTO_MAX) throw erro('texto inválido')
      const r = dep.vendas._interno.registros.find((x) => x.id === vendaId)
      if (!r) throw new ErroApi(404, 'Venda não encontrada', 'NAO_ENCONTRADO')
      return preencher(texto, await dados(r, false), empresa)
    },

    async empresa(s) { exigirAdmin(s, 'Só o administrador vê os dados da empresa'); return { ...empresa } },
    async salvarEmpresa(s, corpo): Promise<EmpresaApi> {
      exigirAdmin(s, 'Só o administrador muda os dados da empresa')
      const texto = (k: 'nome' | 'cnpj' | 'endereco' | 'email' | 'atendente', max: number): string | null => {
        if (!(k in corpo)) return empresa[k]
        const v = corpo[k]
        if (v === null || v === undefined || v === '') { if (k === 'nome') throw erro('A razão social não pode ficar vazia'); return null }
        if (typeof v !== 'string' || v.trim().length > max) throw erro(`${k}: no máximo ${max} letras`)
        return v.trim()
      }
      const dinheiro = (k: 'avaria' | 'reposicao' | 'seguro' | 'recuperacao'): number | null => {
        if (!(k in corpo)) return empresa[k]
        const v = corpo[k]
        if (v === null || v === undefined) return null
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > DINHEIRO_MAX) throw erro(`${k} precisa ser um valor entre 0 e ${DINHEIRO_MAX}`)
        return Math.round(v * 100) / 100
      }
      let cancelamentoPct = empresa.cancelamentoPct
      if ('cancelamentoPct' in corpo) {
        const v = corpo.cancelamentoPct
        if (v === null || v === undefined) cancelamentoPct = null
        else if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) throw erro('cancelamentoPct precisa ficar entre 0 e 100')
        else cancelamentoPct = Math.round(v * 100) / 100
      }
      const nova: Empresa = {
        nome: texto('nome', 120)!, cnpj: texto('cnpj', 18), endereco: texto('endereco', 200), email: texto('email', 120), atendente: texto('atendente', 80),
        avaria: dinheiro('avaria'), reposicao: dinheiro('reposicao'), seguro: dinheiro('seguro'), cancelamentoPct, recuperacao: dinheiro('recuperacao'),
      }
      if (nova.cnpj !== null && nova.cnpj.replace(/\D/g, '').length !== 14) throw erro('CNPJ precisa ter 14 números')
      if (nova.email !== null && !/^\S+@\S+\.\S+$/.test(nova.email)) throw erro('E-mail inválido')
      empresa = nova
      return { ...empresa }
    },
  }

  return { ...api, publico }
}
