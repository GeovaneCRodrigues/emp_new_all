export type StatusAprovacao = 'PENDENTE' | 'APROVADO' | 'RECUSADO'

/** O que o pedido mexe: uma venda de iPhone ou um empréstimo. */
export type Alvo = 'VENDA' | 'EMPRESTIMO'

export type Aprovacao = {
  id: number
  tipo: 'DESCONTO'
  status: StatusAprovacao
  alvo: Alvo
  /** id da venda ou do empréstimo */
  operacaoId: number
  parcela: number
  nParcelas: number
  valor: number
  motivo: string | null
  solicitante: { id: number; nome: string }
  cliente: { id: number; nome: string }
  /** "iPhone 15 Pro" ou "Empréstimo só juros" */
  aparelho: string
  criadaEm: string
  respondidoPor: string | null
  respondidoEm: string | null
  resposta: string | null
}

/** Quais pedidos um pedido pode enxergar: o admin vê todos; o cobrador, só os dele. */
export type EscopoAprovacoes = { tipo: 'TODOS' } | { tipo: 'SOLICITANTE'; usuarioId: number }

export type ParcelaDaOperacao = { id: number; numero: number; valor: number; desconto: number; pago: number; vencimento: string }
export type OperacaoDoPedido = { id: number; alvo: Alvo; clienteId: number; status: 'ATIVA' | 'QUITADA' | 'RETOMADA' | 'CANCELADA' }
