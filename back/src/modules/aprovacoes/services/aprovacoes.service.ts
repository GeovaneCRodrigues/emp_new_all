import { HttpError, naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import type { Sessao } from '../../../shared/perfis.js'
import { hojeBR } from '../../../shared/relogio.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import { validarProposta } from '../../acordos/models/acordo.js'
import { arred2 } from '../../vendas/services/calculo.js'
import type { AprovacoesRepository } from '../models/repository.js'
import type { Alvo, Aprovacao, EscopoAprovacoes, StatusAprovacao, TipoAprovacao } from '../models/types.js'

export type Entrada = Record<string, unknown>
export type ListaAprovacoes = { itens: Aprovacao[]; total: number; pendentes: number; pagina: number; limite: number }

export type AprovacoesService = {
  /** O cobrador pede desconto (padrão), retomada do aparelho ou acordo. */
  pedir(s: Sessao, e: Entrada): Promise<Aprovacao>
  listar(s: Sessao, q: { status?: string; pagina?: number; limite?: number }): Promise<ListaAprovacoes>
  aprovar(s: Sessao, id: number): Promise<Aprovacao>
  recusar(s: Sessao, id: number, e: Entrada): Promise<Aprovacao>
}

const LIMITE_MAX = 100
const STATUS: StatusAprovacao[] = ['PENDENTE', 'APROVADO', 'RECUSADO']
const falta = (p: { valor: number; pago: number; desconto: number }) => arred2(p.valor - p.pago - p.desconto)
const brl = (v: number) => v.toFixed(2).replace('.', ',')

function escopoDe(s: Sessao): EscopoAprovacoes {
  if (s.perfil === 'ADMIN') return { tipo: 'TODOS' }
  if (s.perfil === 'COBRADOR') return { tipo: 'SOLICITANTE', usuarioId: s.usuarioId }
  throw semPermissao('Só o administrador e o cobrador usam os pedidos de aprovação')
}
const exigirAdmin = (s: Sessao) => { if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador aprova ou recusa pedidos') }

function lerMotivo(e: Entrada): string {
  const motivo = typeof e.motivo === 'string' ? e.motivo.trim() : ''
  if (motivo.length < 3 || motivo.length > 500) throw requisicaoInvalida('Explique o motivo do pedido (de 3 a 500 letras)')
  return motivo
}

export function createAprovacoesService(dep: {
  repo: AprovacoesRepository
  auditoria: AuditoriaRepository
  hoje?: () => string
  /** Só para teste: segura a transação depois de ler as parcelas, para forçar duas aprovações a se sobreporem. */
  depoisDeLerParcelas?: () => Promise<void>
}): AprovacoesService {
  const hoje = dep.hoje ?? (() => hojeBR())
  const duplicado = (err: unknown, mensagem: string): never => {
    if ((err as { code?: string }).code === '23505') throw new HttpError(409, mensagem, 'PEDIDO_JA_EXISTE')
    throw err
  }
  const reler = async (id: number) => (await dep.repo.buscar(id, { tipo: 'TODOS' }))!

  // ===================== pedir =====================

  async function pedirDesconto(s: Sessao, e: Entrada): Promise<Aprovacao> {
    if (s.perfil !== 'COBRADOR') throw semPermissao('Só o cobrador pede desconto (o administrador dá o desconto direto ao receber)')
    const alvo = (e.alvo === undefined ? 'VENDA' : e.alvo) as Alvo
    if (alvo !== 'VENDA' && alvo !== 'EMPRESTIMO') throw requisicaoInvalida('alvo deve ser VENDA ou EMPRESTIMO')
    if (typeof e.operacaoId !== 'number' || !Number.isInteger(e.operacaoId) || e.operacaoId < 1) throw requisicaoInvalida(alvo === 'VENDA' ? 'Informe a venda' : 'Informe o empréstimo')
    if (typeof e.parcela !== 'number' || !Number.isInteger(e.parcela) || e.parcela < 1) throw requisicaoInvalida('Informe a parcela')
    if (typeof e.valor !== 'number' || !Number.isFinite(e.valor) || e.valor <= 0) throw requisicaoInvalida('Informe o valor do desconto')
    const motivo = lerMotivo(e)
    const valor = arred2(e.valor)

    const id = await dep.repo
      .emTransacao(async (tx) => {
        const op = await tx.travarOperacao(alvo, e.operacaoId as number, { usuarioId: s.usuarioId })
        if (!op) throw naoEncontrado(alvo === 'VENDA' ? 'Venda não encontrada' : 'Empréstimo não encontrado')
        if (op.status === 'RETOMADA' || op.status === 'CANCELADA') throw new HttpError(409, alvo === 'VENDA' ? 'Esta venda foi retomada ou cancelada' : 'Este empréstimo foi cancelado', 'VENDA_ENCERRADA')
        const p = await tx.parcela(alvo, op.id, e.parcela as number)
        if (!p) throw naoEncontrado('Parcela não encontrada')
        const f = falta(p)
        if (f <= 0.009) throw new HttpError(409, 'Esta parcela já está paga', 'PARCELA_PAGA')
        if (valor > f + 0.009) throw requisicaoInvalida(`O desconto não pode passar do que falta na parcela (${brl(f)})`)
        return tx.criar({ alvo, operacaoId: op.id, parcelaId: p.id, solicitadoPor: s.usuarioId, valor, motivo })
      })
      .catch((err) => duplicado(err, 'Já existe um pedido de desconto esperando para esta parcela'))

    await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'DESCONTO_PEDIDO', entidade: 'aprovacao', entidadeId: id, depois: { alvo, operacaoId: e.operacaoId, parcela: e.parcela, valor, motivo } })
    return reler(id)
  }

  async function pedirRetomada(s: Sessao, e: Entrada): Promise<Aprovacao> {
    if (s.perfil !== 'COBRADOR') throw semPermissao('Só o cobrador pede a retomada (o administrador retoma direto na venda)')
    if (e.alvo !== undefined && e.alvo !== 'VENDA') throw requisicaoInvalida('A retomada do aparelho só vale para venda')
    if (typeof e.operacaoId !== 'number' || !Number.isInteger(e.operacaoId) || e.operacaoId < 1) throw requisicaoInvalida('Informe a venda')
    const motivo = lerMotivo(e)
    const dia = hoje()

    const id = await dep.repo
      .emTransacao(async (tx) => {
        const v = await tx.travarOperacao('VENDA', e.operacaoId as number, { usuarioId: s.usuarioId })
        if (!v) throw naoEncontrado('Venda não encontrada')
        if (v.status !== 'ATIVA') throw new HttpError(409, 'Só dá para pedir a retomada de uma venda em andamento', 'VENDA_NAO_RETOMAVEL')
        const abertas = (await tx.parcelas('VENDA', v.id)).filter((p) => falta(p) > 0.009)
        if (!abertas.some((p) => p.vencimento < dia)) throw new HttpError(409, 'Só dá para pedir a retomada quando o cliente tem parcela atrasada', 'SEM_ATRASO')
        return tx.criarRetomada({ vendaId: v.id, solicitadoPor: s.usuarioId, valor: arred2(abertas.reduce((x, p) => x + falta(p), 0)), motivo })
      })
      .catch((err) => duplicado(err, 'Já existe um pedido de retomada esperando para esta venda'))

    await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'RETOMADA_PEDIDA', entidade: 'aprovacao', entidadeId: id, depois: { vendaId: e.operacaoId, motivo } })
    return reler(id)
  }

  async function pedirAcordo(s: Sessao, e: Entrada): Promise<Aprovacao> {
    if (s.perfil !== 'COBRADOR') throw semPermissao('Só o cobrador pede o acordo (o administrador faz o acordo direto na ficha)')
    const alvo = (e.alvo === undefined ? 'VENDA' : e.alvo) as Alvo
    if (alvo !== 'VENDA' && alvo !== 'EMPRESTIMO') throw requisicaoInvalida('alvo deve ser VENDA ou EMPRESTIMO')
    if (typeof e.operacaoId !== 'number' || !Number.isInteger(e.operacaoId) || e.operacaoId < 1) throw requisicaoInvalida(alvo === 'VENDA' ? 'Informe a venda' : 'Informe o empréstimo')
    const motivo = lerMotivo(e)
    const proposta = validarProposta({ valorTotal: e.valorTotal, parcelas: e.parcelas, primeiraParcela: e.primeiraParcela }, hoje())

    const id = await dep.repo
      .emTransacao(async (tx) => {
        const op = await tx.travarOperacao(alvo, e.operacaoId as number, { usuarioId: s.usuarioId })
        if (!op) throw naoEncontrado(alvo === 'VENDA' ? 'Venda não encontrada' : 'Empréstimo não encontrado')
        if (op.status === 'RETOMADA' || op.status === 'CANCELADA') throw new HttpError(409, alvo === 'VENDA' ? 'Esta venda foi retomada ou cancelada' : 'Este empréstimo foi cancelado', 'VENDA_ENCERRADA')
        const saldo = arred2((await tx.parcelas(alvo, op.id)).reduce((x, p) => x + Math.max(0, falta(p)), 0))
        if (op.status !== 'ATIVA' || saldo <= 0.009) throw new HttpError(409, 'Não há nada em aberto para renegociar', 'SEM_SALDO')
        return tx.criarAcordo({ alvo, operacaoId: op.id, solicitadoPor: s.usuarioId, valorTotal: proposta.valorTotal, motivo, parcelas: proposta.n, primeiraParcela: proposta.primeira, saldoNoPedido: saldo })
      })
      .catch((err) => duplicado(err, 'Já existe um pedido de acordo esperando para esta operação'))

    await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'ACORDO_PEDIDO', entidade: 'aprovacao', entidadeId: id, depois: { alvo, operacaoId: e.operacaoId, valorTotal: proposta.valorTotal, parcelas: proposta.n, primeiraParcela: proposta.primeira, motivo } })
    return reler(id)
  }

  // ===================== aprovar =====================

  async function aprovar(s: Sessao, id: number): Promise<Aprovacao> {
    exigirAdmin(s)
    const dia = hoje()
    const aplicado = await dep.repo.emTransacao(async (tx) => {
      const pedido = await tx.travarPedido(id)
      if (!pedido) throw naoEncontrado('Pedido não encontrado')
      const op = await tx.travarOperacao(pedido.alvo, pedido.operacaoId)
      if (!op) throw naoEncontrado(pedido.alvo === 'VENDA' ? 'Venda não encontrada' : 'Empréstimo não encontrado')
      // relê o pedido depois de travar a operação: outro admin pode ter respondido enquanto esperávamos
      const atual = await tx.travarPedido(id)
      if (!atual || atual.status !== 'PENDENTE') throw new HttpError(409, 'Este pedido já foi respondido', 'PEDIDO_JA_RESPONDIDO')

      if (atual.tipo === 'ACORDO') {
        if (!atual.dados) throw new HttpError(409, 'Pedido de acordo sem proposta', 'PEDIDO_DESATUALIZADO')
        // a 1ª parcela proposta pode já ter passado enquanto o pedido esperava
        if (atual.dados.primeiraParcela < dia) throw new HttpError(409, 'A data da 1ª parcela proposta já passou. Recuse o pedido e peça de novo.', 'PEDIDO_DESATUALIZADO')
        const r = await tx.fazerAcordo({ alvo: pedido.alvo, operacaoId: op.id, usuarioId: s.usuarioId, valorTotal: atual.valor, n: atual.dados.parcelas, primeira: atual.dados.primeiraParcela, motivo: atual.motivo, dia, aprovacaoId: id, saldoEsperado: atual.dados.saldoNoPedido })
        await tx.responder(id, 'APROVADO', s.usuarioId, null)
        return { tipo: 'ACORDO' as const, alvo: pedido.alvo, operacaoId: op.id, acordoId: r.acordoId, valorTotal: r.valorTotal, parcelas: r.nParcelas, saldoAntes: r.saldoAntes }
      }

      if (atual.tipo === 'RETOMADA') {
        // a venda pode ter sido retomada/cancelada por outro caminho, ou o cliente pode ter pago o atraso
        if (op.status === 'RETOMADA' || op.status === 'CANCELADA') throw new HttpError(409, 'Esta venda foi retomada ou cancelada', 'VENDA_ENCERRADA')
        const r = await tx.retomar({ vendaId: op.id, usuarioId: s.usuarioId, motivo: atual.motivo, dia, excetoPedidoId: id }).catch((err) => {
          if (err instanceof HttpError && err.code === 'SEM_ATRASO') throw new HttpError(409, 'O cliente já não tem parcela atrasada: recuse o pedido', 'PEDIDO_DESATUALIZADO')
          throw err
        })
        await tx.responder(id, 'APROVADO', s.usuarioId, null)
        return { tipo: 'RETOMADA' as const, alvo: 'VENDA' as const, operacaoId: op.id, emAberto: r.emAberto, atrasadas: r.atrasadas, bemId: r.bemId }
      }

      if (op.status === 'RETOMADA' || op.status === 'CANCELADA') throw new HttpError(409, pedido.alvo === 'VENDA' ? 'Esta venda foi retomada ou cancelada' : 'Este empréstimo foi cancelado', 'VENDA_ENCERRADA')
      const parcelas = await tx.parcelas(pedido.alvo, op.id)
      await dep.depoisDeLerParcelas?.()
      const p = parcelas.find((x) => x.id === atual.parcelaId)!
      const f = falta(p)
      // a parcela pode ter mudado desde o pedido (o cliente pagou, outro desconto): o pedido não cabe mais
      if (atual.valor > f + 0.009) throw new HttpError(409, f <= 0.009 ? 'A parcela já foi paga: o pedido não faz mais sentido' : `A parcela mudou: agora faltam só ${brl(f)}. Recuse o pedido e peça de novo.`, 'PEDIDO_DESATUALIZADO')

      const novoDesconto = arred2(p.desconto + atual.valor)
      const quita = arred2(f - atual.valor) <= 0.009
      await tx.aplicarDesconto(pedido.alvo, p.id, novoDesconto, quita ? dia : null)
      const depois = parcelas.map((x) => (x.id === p.id ? { ...x, desconto: novoDesconto } : x))
      await tx.definirStatus(pedido.alvo, op.id, depois.every((x) => falta(x) <= 0.009) ? 'QUITADA' : 'ATIVA')
      await tx.responder(id, 'APROVADO', s.usuarioId, null)
      return { tipo: 'DESCONTO' as const, alvo: pedido.alvo, operacaoId: op.id, parcela: p.numero, valor: atual.valor }
    })

    const entidade = aplicado.alvo === 'VENDA' ? 'venda' : 'emprestimo'
    if (aplicado.tipo === 'ACORDO') await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'ACORDO_FEITO', entidade, entidadeId: aplicado.operacaoId, depois: { aprovacaoId: id, acordoId: aplicado.acordoId, valorTotal: aplicado.valorTotal, parcelas: aplicado.parcelas, saldoAntes: aplicado.saldoAntes } })
    else if (aplicado.tipo === 'RETOMADA') await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'VENDA_RETOMADA', entidade, entidadeId: aplicado.operacaoId, depois: { aprovacaoId: id, emAberto: aplicado.emAberto, parcelasAtrasadas: aplicado.atrasadas, aparelhoId: aplicado.bemId } })
    else await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'DESCONTO_CONCEDIDO', entidade, entidadeId: aplicado.operacaoId, depois: { aprovacaoId: id, parcela: aplicado.parcela, valor: aplicado.valor } })
    await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'APROVACAO_APROVADA', entidade: 'aprovacao', entidadeId: id, depois: aplicado })
    return reler(id)
  }

  // ===================== recusar =====================

  async function recusar(s: Sessao, id: number, e: Entrada): Promise<Aprovacao> {
    exigirAdmin(s)
    const resposta = typeof e.motivo === 'string' && e.motivo.trim() ? e.motivo.trim().slice(0, 500) : null
    await dep.repo.emTransacao(async (tx) => {
      const pedido = await tx.travarPedido(id)
      if (!pedido) throw naoEncontrado('Pedido não encontrado')
      if (pedido.status !== 'PENDENTE') throw new HttpError(409, 'Este pedido já foi respondido', 'PEDIDO_JA_RESPONDIDO')
      await tx.responder(id, 'RECUSADO', s.usuarioId, resposta)
    })
    await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'APROVACAO_RECUSADA', entidade: 'aprovacao', entidadeId: id, depois: { motivo: resposta } })
    return reler(id)
  }

  return {
    async pedir(s, e) {
      const tipo = (e.tipo === undefined ? 'DESCONTO' : e.tipo) as TipoAprovacao
      if (tipo === 'DESCONTO') return pedirDesconto(s, e)
      if (tipo === 'RETOMADA') return pedirRetomada(s, e)
      if (tipo === 'ACORDO') return pedirAcordo(s, e)
      throw requisicaoInvalida('tipo deve ser DESCONTO, RETOMADA ou ACORDO')
    },

    async listar(s, q) {
      const escopo = escopoDe(s)
      if (q.status && !STATUS.includes(q.status as StatusAprovacao)) throw requisicaoInvalida('status inválido')
      const limite = Math.min(Math.max(Math.trunc(q.limite ?? 20) || 20, 1), LIMITE_MAX)
      const pagina = Math.max(Math.trunc(q.pagina ?? 1) || 1, 1)
      const r = await dep.repo.listar(escopo, { status: q.status as StatusAprovacao | undefined, limite, offset: (pagina - 1) * limite })
      return { ...r, pagina, limite }
    },

    aprovar,
    recusar,
  }
}
