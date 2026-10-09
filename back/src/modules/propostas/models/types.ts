export type TipoProposta = 'VENDA' | 'EMPRESTIMO'
export type StatusProposta = 'PENDENTE' | 'ACEITA' | 'RECUSADA' | 'CANCELADA'

/** A intenção do indicador sobre um cliente dele. A loja só aceita ou recusa e cadastra a venda/empréstimo. */
export type Proposta = {
  id: number
  indicador: { id: number; nome: string }
  cliente: { id: number; nome: string; fone: string }
  tipo: TipoProposta
  /** o que o cliente quer, em texto ("iPhone 14 128 GB", "pra reformar a loja") */
  interesse: string | null
  aparelho: { id: number; modelo: string; gb: number; cor: string } | null
  valor: number | null
  parcelas: number | null
  obs: string | null
  status: StatusProposta
  motivoRecusa: string | null
  respondidoPor: string | null
  respondidoEm: string | null
  /** a venda ou o empréstimo que a loja cadastrou a partir da proposta */
  operacao: { tipo: TipoProposta; id: number } | null
  criadaEm: string
}

export type NovaProposta = {
  indicadorId: number
  clienteId: number
  tipo: TipoProposta
  interesse: string | null
  aparelhoId: number | null
  valor: number | null
  parcelas: number | null
  obs: string | null
}

export type EscopoPropostas = { tipo: 'TODOS' } | { tipo: 'INDICADOR'; indicadorId: number }
export type FiltroPropostas = { status?: StatusProposta; indicadorId?: number; limite: number; offset: number }
