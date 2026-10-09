export type StatusAprovacao = 'PENDENTE' | 'APROVADO' | 'RECUSADO'

export type Aprovacao = {
  id: number
  tipo: 'DESCONTO'
  status: StatusAprovacao
  vendaId: number
  parcela: number
  nParcelas: number
  valor: number
  motivo: string | null
  solicitante: { id: number; nome: string }
  cliente: { id: number; nome: string }
  aparelho: string
  criadaEm: string
  respondidoPor: string | null
  respondidoEm: string | null
  resposta: string | null
}

/** Quais pedidos um pedido pode enxergar: o admin vê todos; o cobrador, só os dele. */
export type EscopoAprovacoes = { tipo: 'TODOS' } | { tipo: 'SOLICITANTE'; usuarioId: number }

export type ParcelaDaVenda = { id: number; numero: number; valor: number; desconto: number; pago: number; vencimento: string }
export type VendaDoPedido = { id: number; clienteId: number; status: 'ATIVA' | 'QUITADA' | 'RETOMADA' | 'CANCELADA' }
