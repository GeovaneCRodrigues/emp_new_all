export type StatusAprovacao = 'PENDENTE' | 'APROVADO' | 'RECUSADO'

/** O que o pedido mexe: uma venda de iPhone ou um empréstimo. */
export type Alvo = 'VENDA' | 'EMPRESTIMO'
export type TipoAprovacao = 'DESCONTO' | 'RETOMADA' | 'ACORDO'

export type Aprovacao = {
  id: number
  tipo: TipoAprovacao
  status: StatusAprovacao
  alvo: Alvo
  /** id da venda ou do empréstimo */
  operacaoId: number
  /** a parcela do desconto (a retomada é da venda toda: sem parcela) */
  parcela: number | null
  nParcelas: number
  /** desconto: o valor pedido. Retomada: o que estava em aberto na venda quando pediu. Acordo: o valor total proposto. */
  valor: number
  /** só no pedido de acordo: o que o cobrador propôs */
  acordo: { parcelas: number; primeiraParcela: string; saldoNoPedido: number } | null
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
