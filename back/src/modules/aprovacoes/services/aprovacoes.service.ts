import { HttpError, naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import type { Sessao } from '../../../shared/perfis.js'
import { hojeBR } from '../../../shared/relogio.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import { arred2 } from '../../vendas/services/calculo.js'
import type { AprovacoesRepository } from '../models/repository.js'
import type { Aprovacao, EscopoAprovacoes, StatusAprovacao } from '../models/types.js'

export type Entrada = Record<string, unknown>
export type ListaAprovacoes = { itens: Aprovacao[]; total: number; pendentes: number; pagina: number; limite: number }

export type AprovacoesService = {
  pedirDesconto(s: Sessao, e: Entrada): Promise<Aprovacao>
  listar(s: Sessao, q: { status?: string; pagina?: number; limite?: number }): Promise<ListaAprovacoes>
  aprovar(s: Sessao, id: number): Promise<Aprovacao>
  recusar(s: Sessao, id: number, e: Entrada): Promise<Aprovacao>
}

const LIMITE_MAX = 100
const STATUS: StatusAprovacao[] = ['PENDENTE', 'APROVADO', 'RECUSADO']
const falta = (p: { valor: number; pago: number; desconto: number }) => arred2(p.valor - p.pago - p.desconto)

function escopoDe(s: Sessao): EscopoAprovacoes {
  if (s.perfil === 'ADMIN') return { tipo: 'TODOS' }
  if (s.perfil === 'COBRADOR') return { tipo: 'SOLICITANTE', usuarioId: s.usuarioId }
  throw semPermissao('Só o administrador e o cobrador usam os pedidos de aprovação')
}
const exigirAdmin = (s: Sessao) => { if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador aprova ou recusa pedidos') }

export function createAprovacoesService(dep: {
  repo: AprovacoesRepository
  auditoria: AuditoriaRepository
  hoje?: () => string
  /** Só para teste: segura a transação depois de ler as parcelas, para forçar duas aprovações a se sobreporem. */
  depoisDeLerParcelas?: () => Promise<void>
}): AprovacoesService {
  const hoje = dep.hoje ?? (() => hojeBR())
  const PENDENTE_DUPLICADO = new HttpError(409, 'Já existe um pedido de desconto esperando para esta parcela', 'PEDIDO_JA_EXISTE')

  return {
    async pedirDesconto(s, e) {
      if (s.perfil !== 'COBRADOR') throw semPermissao('Só o cobrador pede desconto (o administrador dá o desconto direto ao receber)')
      if (typeof e.vendaId !== 'number' || !Number.isInteger(e.vendaId) || e.vendaId < 1) throw requisicaoInvalida('Informe a venda')
      if (typeof e.parcela !== 'number' || !Number.isInteger(e.parcela) || e.parcela < 1) throw requisicaoInvalida('Informe a parcela')
      if (typeof e.valor !== 'number' || !Number.isFinite(e.valor) || e.valor <= 0) throw requisicaoInvalida('Informe o valor do desconto')
      const motivo = typeof e.motivo === 'string' ? e.motivo.trim() : ''
      if (motivo.length < 3 || motivo.length > 500) throw requisicaoInvalida('Explique o motivo do pedido (de 3 a 500 letras)')
      const valor = arred2(e.valor)

      const id = await dep.repo
        .emTransacao(async (tx) => {
          const venda = await tx.travarVenda(e.vendaId as number, { usuarioId: s.usuarioId })
          if (!venda) throw naoEncontrado('Venda não encontrada')
          if (venda.status === 'RETOMADA' || venda.status === 'CANCELADA') throw new HttpError(409, 'Esta venda foi retomada ou cancelada', 'VENDA_ENCERRADA')
          const p = await tx.parcela(venda.id, e.parcela as number)
          if (!p) throw naoEncontrado('Parcela não encontrada')
          const f = falta(p)
          if (f <= 0.009) throw new HttpError(409, 'Esta parcela já está paga', 'PARCELA_PAGA')
          if (valor > f + 0.009) throw requisicaoInvalida(`O desconto não pode passar do que falta na parcela (${f.toFixed(2).replace('.', ',')})`)
          return tx.criar({ vendaId: venda.id, parcelaId: p.id, solicitadoPor: s.usuarioId, valor, motivo })
        })
        .catch((err) => { if ((err as { code?: string }).code === '23505') throw PENDENTE_DUPLICADO; throw err })

      await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'DESCONTO_PEDIDO', entidade: 'aprovacao', entidadeId: id, depois: { vendaId: e.vendaId, parcela: e.parcela, valor, motivo } })
      return (await dep.repo.buscar(id, { tipo: 'TODOS' }))!
    },

    async listar(s, q) {
      const escopo = escopoDe(s)
      if (q.status && !STATUS.includes(q.status as StatusAprovacao)) throw requisicaoInvalida('status inválido')
      const limite = Math.min(Math.max(Math.trunc(q.limite ?? 20) || 20, 1), LIMITE_MAX)
      const pagina = Math.max(Math.trunc(q.pagina ?? 1) || 1, 1)
      const r = await dep.repo.listar(escopo, { status: q.status as StatusAprovacao | undefined, limite, offset: (pagina - 1) * limite })
      return { ...r, pagina, limite }
    },

    async aprovar(s, id) {
      exigirAdmin(s)
      const dia = hoje()
      const aplicado = await dep.repo.emTransacao(async (tx) => {
        const pedido = await tx.travarPedido(id)
        if (!pedido) throw naoEncontrado('Pedido não encontrado')
        const venda = await tx.travarVenda(pedido.vendaId)
        if (!venda) throw naoEncontrado('Venda não encontrada')
        // relê o pedido depois de travar a venda: outro admin pode ter respondido enquanto esperávamos
        const atual = await tx.travarPedido(id)
        if (!atual || atual.status !== 'PENDENTE') throw new HttpError(409, 'Este pedido já foi respondido', 'PEDIDO_JA_RESPONDIDO')
        if (venda.status === 'RETOMADA' || venda.status === 'CANCELADA') throw new HttpError(409, 'Esta venda foi retomada ou cancelada', 'VENDA_ENCERRADA')

        const parcelas = await tx.parcelas(venda.id)
        await dep.depoisDeLerParcelas?.()
        const p = parcelas.find((x) => x.id === atual.parcelaId)!
        const f = falta(p)
        // a parcela pode ter mudado desde o pedido (o cliente pagou, outro desconto): o pedido não cabe mais
        if (atual.valor > f + 0.009) throw new HttpError(409, f <= 0.009 ? 'A parcela já foi paga: o pedido não faz mais sentido' : `A parcela mudou: agora faltam só ${f.toFixed(2).replace('.', ',')}. Recuse o pedido e peça de novo.`, 'PEDIDO_DESATUALIZADO')

        const novoDesconto = arred2(p.desconto + atual.valor)
        const quita = arred2(f - atual.valor) <= 0.009
        await tx.aplicarDesconto(p.id, novoDesconto, quita ? dia : null)
        const depois = parcelas.map((x) => (x.id === p.id ? { ...x, desconto: novoDesconto } : x))
        await tx.definirStatusVenda(venda.id, depois.every((x) => falta(x) <= 0.009) ? 'QUITADA' : 'ATIVA')
        await tx.responder(id, 'APROVADO', s.usuarioId, null)
        return { vendaId: venda.id, parcela: p.numero, valor: atual.valor }
      })
      await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'DESCONTO_CONCEDIDO', entidade: 'venda', entidadeId: aplicado.vendaId, depois: { aprovacaoId: id, parcela: aplicado.parcela, valor: aplicado.valor } })
      await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'APROVACAO_APROVADA', entidade: 'aprovacao', entidadeId: id, depois: aplicado })
      return (await dep.repo.buscar(id, { tipo: 'TODOS' }))!
    },

    async recusar(s, id, e) {
      exigirAdmin(s)
      const resposta = typeof e.motivo === 'string' && e.motivo.trim() ? e.motivo.trim().slice(0, 500) : null
      await dep.repo.emTransacao(async (tx) => {
        const pedido = await tx.travarPedido(id)
        if (!pedido) throw naoEncontrado('Pedido não encontrado')
        if (pedido.status !== 'PENDENTE') throw new HttpError(409, 'Este pedido já foi respondido', 'PEDIDO_JA_RESPONDIDO')
        await tx.responder(id, 'RECUSADO', s.usuarioId, resposta)
      })
      await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'APROVACAO_RECUSADA', entidade: 'aprovacao', entidadeId: id, depois: { motivo: resposta } })
      return (await dep.repo.buscar(id, { tipo: 'TODOS' }))!
    },
  }
}
