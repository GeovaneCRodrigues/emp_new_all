import type { Sessao } from '@/domain/escopo'
import { ErroApi, type ClientesApi } from './clientes'
import type { EmprestimosApi } from './emprestimos'
import type { EstoqueApi } from './estoque'
import type { IndicadoresApi } from './indicadores'
import type { EntradaProposta, ListaPropostas, PropostaApi, PropostasApi, StatusProposta } from './propostas'
import type { VendasApi } from './vendas'

const STATUS: StatusProposta[] = ['PENDENTE', 'ACEITA', 'RECUSADA', 'CANCELADA']
const nao = (status: number, msg: string, codigo?: string) => new ErroApi(status, msg, codigo)
const ADM: Sessao = { perfil: 'ADMIN', usuarioId: 1 } // a demonstração lê o que precisa como administrador; quem pode o quê já foi checado acima

const texto = (v: unknown, campo: string, max: number): string | null => {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string') throw nao(400, `${campo} deve ser texto`)
  const t = v.trim().replace(/[ \t]+/g, ' ')
  if (t.length > max) throw nao(400, `${campo}: no máximo ${max} letras`)
  return t || null
}
const inteiro = (v: unknown, campo: string, min: number, max: number) => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw nao(400, `${campo} precisa ser um número inteiro entre ${min} e ${max}`)
  return v
}

/**
 * Versão de demonstração: mesmas regras do backend (a proposta é só intenção; a loja aceita ou recusa;
 * quem decide é o administrador; o indicador só enxerga e cancela as dele).
 */
export function criarPropostasFake(d: { clientes: ClientesApi; estoque: EstoqueApi; vendas: VendasApi; emprestimos: EmprestimosApi; indicadores: IndicadoresApi; hoje: string }): PropostasApi {
  const registros: PropostaApi[] = []
  let seq = 0
  const agora = () => `${d.hoje}T12:00:00.000Z`

  const noEscopo = (s: Sessao) => {
    if (s.perfil === 'ADMIN') return registros
    if (s.perfil === 'INDICADOR' && s.indicadorId != null) return registros.filter((p) => p.indicador.id === s.indicadorId)
    throw nao(403, 'Você não tem acesso às propostas', 'SEM_PERMISSAO')
  }
  const exigirAdmin = (s: Sessao) => { if (s.perfil !== 'ADMIN') throw nao(403, 'Só o administrador responde as propostas', 'SEM_PERMISSAO') }
  const jaRespondida = (p: PropostaApi) => nao(409, `Esta proposta já está ${p.status === 'ACEITA' ? 'aceita' : p.status === 'RECUSADA' ? 'recusada' : 'cancelada'}`, 'PROPOSTA_JA_RESPONDIDA')
  const achar = (s: Sessao, id: number) => noEscopo(s).find((p) => p.id === id) ?? (() => { throw nao(404, 'Proposta não encontrada', 'NAO_ENCONTRADO') })()
  const copia = (p: PropostaApi): PropostaApi => ({ ...p })

  return {
    async criar(s, e: EntradaProposta) {
      if (s.perfil !== 'INDICADOR' || s.indicadorId == null) throw nao(403, 'Só o indicador manda proposta', 'SEM_PERMISSAO')
      const clienteId = inteiro(e.clienteId, 'clienteId', 1, 2 ** 31 - 1)
      if (e.tipo !== 'VENDA' && e.tipo !== 'EMPRESTIMO') throw nao(400, 'tipo deve ser VENDA ou EMPRESTIMO')
      let interesse = texto(e.interesse, 'interesse', 160)
      const obs = texto(e.obs, 'obs', 500)
      let valor: number | null = null
      if (e.valor !== undefined && e.valor !== null) {
        if (typeof e.valor !== 'number' || !Number.isFinite(e.valor) || e.valor <= 0 || e.valor > 100_000_000) throw nao(400, 'valor precisa ser maior que zero')
        valor = Math.round(e.valor * 100) / 100
      }
      const parcelas = e.parcelas === undefined || e.parcelas === null ? null : inteiro(e.parcelas, 'parcelas', 1, 120)
      let aparelho: PropostaApi['aparelho'] = null
      if (e.aparelhoId !== undefined && e.aparelhoId !== null) {
        if (e.tipo !== 'VENDA') throw nao(400, 'Só uma proposta de venda tem aparelho')
        const id = inteiro(e.aparelhoId, 'aparelhoId', 1, 2 ** 31 - 1)
        const a = await d.estoque.obter(ADM, id).catch(() => null)
        if (!a) throw nao(400, 'Aparelho não encontrado')
        aparelho = { id: a.id, modelo: a.modelo, gb: a.gb, cor: a.cor }
        interesse ??= `${a.modelo} ${a.gb} GB ${a.cor}`
      }
      if (!interesse && valor === null) throw nao(400, e.tipo === 'VENDA' ? 'Diga qual aparelho o cliente quer' : 'Diga quanto o cliente quer pegar')
      // 404 igual a cliente que não existe: não revela cliente de outro indicador
      const cliente = await d.clientes.obter(s, clienteId).catch(() => null)
      if (!cliente) throw nao(404, 'Cliente não encontrado', 'NAO_ENCONTRADO')
      const ind = (await d.indicadores.listar(ADM)).find((i) => i.id === s.indicadorId)
      const p: PropostaApi = {
        id: ++seq, indicador: { id: s.indicadorId, nome: ind?.nome ?? 'Indicador' }, cliente: { id: cliente.id, nome: cliente.nome, fone: cliente.fone },
        tipo: e.tipo, interesse, aparelho, valor, parcelas, obs, status: 'PENDENTE', motivoRecusa: null, respondidoPor: null, respondidoEm: null, operacao: null, criadaEm: agora(),
      }
      registros.push(p)
      return copia(p)
    },

    async listar(s, q): Promise<ListaPropostas> {
      const base = noEscopo(s)
      if (q.status && !STATUS.includes(q.status)) throw nao(400, 'status inválido')
      const limite = Math.min(Math.max(Math.trunc(q.limite ?? 20) || 20, 1), 100)
      const pagina = Math.max(Math.trunc(q.pagina ?? 1) || 1, 1)
      const filtradas = base.filter((p) => (!q.status || p.status === q.status) && (s.perfil !== 'ADMIN' || !q.indicadorId || p.indicador.id === q.indicadorId))
        .sort((a, b) => Number(b.status === 'PENDENTE') - Number(a.status === 'PENDENTE') || b.id - a.id)
      return { itens: filtradas.slice((pagina - 1) * limite, pagina * limite).map(copia), total: filtradas.length, pendentes: base.filter((p) => p.status === 'PENDENTE').length, pagina, limite }
    },

    async obter(s, id) { return copia(achar(s, id)) },

    async aceitar(s, id, e = {}) {
      exigirAdmin(s)
      if (e.vendaId != null && e.emprestimoId != null) throw nao(400, 'Informe a venda ou o empréstimo, não os dois')
      const ligar = e.vendaId != null ? { tipo: 'VENDA' as const, id: inteiro(e.vendaId, 'vendaId', 1, 2 ** 31 - 1) } : e.emprestimoId != null ? { tipo: 'EMPRESTIMO' as const, id: inteiro(e.emprestimoId, 'emprestimoId', 1, 2 ** 31 - 1) } : null
      const p = achar(s, id)
      if (p.status !== 'PENDENTE') throw jaRespondida(p)
      if (ligar) {
        if (ligar.tipo !== p.tipo) throw nao(400, p.tipo === 'VENDA' ? 'Esta proposta é de venda, não de empréstimo' : 'Esta proposta é de empréstimo, não de venda')
        const op = ligar.tipo === 'VENDA' ? await d.vendas.obter(ADM, ligar.id).catch(() => null) : await d.emprestimos.obter(ADM, ligar.id).catch(() => null)
        if (!op) throw nao(404, ligar.tipo === 'VENDA' ? 'Venda não encontrada' : 'Empréstimo não encontrado', 'NAO_ENCONTRADO')
        if (op.cliente.id !== p.cliente.id || op.indicador?.id !== p.indicador.id) throw nao(400, 'Esta operação não é do cliente e do indicador da proposta')
        if (registros.some((x) => x.operacao?.tipo === ligar.tipo && x.operacao.id === ligar.id)) throw nao(409, 'Esta venda ou empréstimo já está ligada a outra proposta', 'OPERACAO_JA_LIGADA')
      }
      Object.assign(p, { status: 'ACEITA', respondidoPor: 'Geovane Cataneo', respondidoEm: agora(), operacao: ligar })
      return copia(p)
    },

    async recusar(s, id, e = {}) {
      exigirAdmin(s)
      const motivo = texto(e.motivo, 'motivo', 300)
      const p = achar(s, id)
      if (p.status !== 'PENDENTE') throw jaRespondida(p)
      Object.assign(p, { status: 'RECUSADA', respondidoPor: 'Geovane Cataneo', respondidoEm: agora(), motivoRecusa: motivo })
      return copia(p)
    },

    async cancelar(s, id) {
      if (s.perfil !== 'INDICADOR') throw nao(403, 'Só o indicador cancela a própria proposta', 'SEM_PERMISSAO')
      const p = achar(s, id)
      if (p.status !== 'PENDENTE') throw jaRespondida(p)
      Object.assign(p, { status: 'CANCELADA', respondidoEm: agora() })
      return copia(p)
    },
  }
}
