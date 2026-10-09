import { HttpError, naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import type { Sessao } from '../../../shared/perfis.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import type { PropostasRepository } from '../models/repository.js'
import type { EscopoPropostas, Proposta, StatusProposta, TipoProposta } from '../models/types.js'

export type Entrada = Record<string, unknown>
export type ResultadoLista = { itens: Proposta[]; total: number; pendentes: number; pagina: number; limite: number }

export type PropostasService = {
  /** O indicador manda a intenção sobre um cliente dele. */
  criar(s: Sessao, e: Entrada): Promise<Proposta>
  /** O administrador vê todas; o indicador, só as dele. */
  listar(s: Sessao, q: { status?: string; indicadorId?: number; pagina?: number; limite?: number }): Promise<ResultadoLista>
  obter(s: Sessao, id: number): Promise<Proposta>
  /** A loja aceita (e, se já cadastrou a venda ou o empréstimo, liga a proposta a ele). Só o administrador. */
  aceitar(s: Sessao, id: number, e: Entrada): Promise<Proposta>
  recusar(s: Sessao, id: number, e: Entrada): Promise<Proposta>
  /** O indicador desiste de uma proposta que ainda não foi respondida. */
  cancelar(s: Sessao, id: number): Promise<Proposta>
}

const STATUS: StatusProposta[] = ['PENDENTE', 'ACEITA', 'RECUSADA', 'CANCELADA']
const TIPOS: TipoProposta[] = ['VENDA', 'EMPRESTIMO']
const LIMITE_MAX = 100
const DINHEIRO_MAX = 100_000_000
export const JA_RESPONDIDA = 'PROPOSTA_JA_RESPONDIDA'

const inteiro = (v: unknown, campo: string, min: number, max: number) => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw requisicaoInvalida(`${campo} precisa ser um número inteiro entre ${min} e ${max}`)
  return v
}
function texto(e: Entrada, campo: string, max: number): string | null {
  const v = e[campo]
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string') throw requisicaoInvalida(`${campo} deve ser texto`)
  const t = v.trim().replace(/[ \t]+/g, ' ')
  if (t.length > max) throw requisicaoInvalida(`${campo}: no máximo ${max} letras`)
  return t || null
}

export function createPropostasService(d: { repo: PropostasRepository; auditoria: AuditoriaRepository }): PropostasService {
  const escopoDe = (s: Sessao): EscopoPropostas => {
    if (s.perfil === 'ADMIN') return { tipo: 'TODOS' }
    if (s.perfil === 'INDICADOR' && s.indicadorId != null) return { tipo: 'INDICADOR', indicadorId: s.indicadorId }
    throw semPermissao('Você não tem acesso às propostas')
  }
  const exigirAdmin = (s: Sessao) => { if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador responde as propostas') }
  const jaRespondida = (p: Proposta) => new HttpError(409, `Esta proposta já está ${p.status === 'ACEITA' ? 'aceita' : p.status === 'RECUSADA' ? 'recusada' : 'cancelada'}`, JA_RESPONDIDA)

  return {
    async criar(s, e) {
      if (s.perfil !== 'INDICADOR' || s.indicadorId == null) throw semPermissao('Só o indicador manda proposta')
      const clienteId = inteiro(e.clienteId, 'clienteId', 1, 2 ** 31 - 1)
      if (typeof e.tipo !== 'string' || !TIPOS.includes(e.tipo as TipoProposta)) throw requisicaoInvalida('tipo deve ser VENDA ou EMPRESTIMO')
      const tipo = e.tipo as TipoProposta
      let interesse = texto(e, 'interesse', 160)
      const obs = texto(e, 'obs', 500)
      let valor: number | null = null
      if (e.valor !== undefined && e.valor !== null) {
        if (typeof e.valor !== 'number' || !Number.isFinite(e.valor) || e.valor <= 0 || e.valor > DINHEIRO_MAX) throw requisicaoInvalida('valor precisa ser maior que zero')
        valor = Math.round(e.valor * 100) / 100
      }
      const parcelas = e.parcelas === undefined || e.parcelas === null ? null : inteiro(e.parcelas, 'parcelas', 1, 120)
      let aparelhoId: number | null = null
      if (e.aparelhoId !== undefined && e.aparelhoId !== null) {
        if (tipo !== 'VENDA') throw requisicaoInvalida('Só uma proposta de venda tem aparelho')
        aparelhoId = inteiro(e.aparelhoId, 'aparelhoId', 1, 2 ** 31 - 1)
        const a = await d.repo.aparelhoExiste(aparelhoId)
        if (!a) throw requisicaoInvalida('Aparelho não encontrado')
        interesse ??= `${a.modelo} ${a.gb} GB ${a.cor}`
      }
      if (!interesse && valor === null) throw requisicaoInvalida(tipo === 'VENDA' ? 'Diga qual aparelho o cliente quer' : 'Diga quanto o cliente quer pegar')
      // 404 igual a cliente que não existe: não revela cliente de outro indicador
      if (!(await d.repo.clienteDoIndicador(clienteId, s.indicadorId))) throw naoEncontrado('Cliente não encontrado')

      const p = await d.repo.criar({ indicadorId: s.indicadorId, clienteId, tipo, interesse, aparelhoId, valor, parcelas, obs })
      await d.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'PROPOSTA_CRIADA', entidade: 'proposta', entidadeId: p.id, depois: { clienteId, tipo, interesse, aparelhoId, valor, parcelas } })
      return p
    },

    async listar(s, q) {
      const escopo = escopoDe(s)
      if (q.status && !STATUS.includes(q.status as StatusProposta)) throw requisicaoInvalida('status inválido')
      const limite = Math.min(Math.max(Math.trunc(q.limite ?? 20) || 20, 1), LIMITE_MAX)
      const pagina = Math.max(Math.trunc(q.pagina ?? 1) || 1, 1)
      const r = await d.repo.listar(escopo, { status: q.status as StatusProposta | undefined, indicadorId: s.perfil === 'ADMIN' ? q.indicadorId : undefined, limite, offset: (pagina - 1) * limite })
      return { ...r, pagina, limite }
    },

    async obter(s, id) {
      const p = await d.repo.buscar(id, escopoDe(s))
      if (!p) throw naoEncontrado('Proposta não encontrada')
      return p
    },

    async aceitar(s, id, e) {
      exigirAdmin(s)
      const ligar = e.vendaId !== undefined && e.vendaId !== null ? { tipo: 'VENDA' as const, id: inteiro(e.vendaId, 'vendaId', 1, 2 ** 31 - 1) }
        : e.emprestimoId !== undefined && e.emprestimoId !== null ? { tipo: 'EMPRESTIMO' as const, id: inteiro(e.emprestimoId, 'emprestimoId', 1, 2 ** 31 - 1) } : null
      if (e.vendaId != null && e.emprestimoId != null) throw requisicaoInvalida('Informe a venda ou o empréstimo, não os dois')
      const r = await d.repo.emTransacao({ tipo: 'TODOS' }, async (tx) => {
        const p = await tx.buscarTravada(id)
        if (!p) throw naoEncontrado('Proposta não encontrada')
        if (p.status !== 'PENDENTE') throw jaRespondida(p)
        if (ligar) {
          if (ligar.tipo !== p.tipo) throw requisicaoInvalida(p.tipo === 'VENDA' ? 'Esta proposta é de venda, não de empréstimo' : 'Esta proposta é de empréstimo, não de venda')
          const op = await tx.operacao(ligar.tipo, ligar.id)
          if (!op) throw naoEncontrado(ligar.tipo === 'VENDA' ? 'Venda não encontrada' : 'Empréstimo não encontrado')
          if (op.clienteId !== p.cliente.id || op.indicadorId !== p.indicador.id) throw requisicaoInvalida('Esta operação não é do cliente e do indicador da proposta')
        }
        return tx.responder(id, { status: 'ACEITA', usuarioId: s.usuarioId, operacao: ligar }).catch((err) => {
          if ((err as { code?: string })?.code === '23505') throw new HttpError(409, 'Esta venda ou empréstimo já está ligada a outra proposta', 'OPERACAO_JA_LIGADA')
          throw err
        })
      })
      await d.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'PROPOSTA_ACEITA', entidade: 'proposta', entidadeId: id, depois: { operacao: ligar } })
      return r
    },

    async recusar(s, id, e) {
      exigirAdmin(s)
      const motivo = texto(e, 'motivo', 300)
      const r = await d.repo.emTransacao({ tipo: 'TODOS' }, async (tx) => {
        const p = await tx.buscarTravada(id)
        if (!p) throw naoEncontrado('Proposta não encontrada')
        if (p.status !== 'PENDENTE') throw jaRespondida(p)
        return tx.responder(id, { status: 'RECUSADA', usuarioId: s.usuarioId, motivo })
      })
      await d.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'PROPOSTA_RECUSADA', entidade: 'proposta', entidadeId: id, depois: { motivo } })
      return r
    },

    async cancelar(s, id) {
      const escopo = escopoDe(s)
      if (s.perfil !== 'INDICADOR') throw semPermissao('Só o indicador cancela a própria proposta')
      const r = await d.repo.emTransacao(escopo, async (tx) => {
        const p = await tx.buscarTravada(id) // fora do escopo = 404
        if (!p) throw naoEncontrado('Proposta não encontrada')
        if (p.status !== 'PENDENTE') throw jaRespondida(p)
        return tx.responder(id, { status: 'CANCELADA', usuarioId: s.usuarioId })
      })
      await d.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'PROPOSTA_CANCELADA', entidade: 'proposta', entidadeId: id })
      return r
    },
  }
}
