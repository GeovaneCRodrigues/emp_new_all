import type { Sessao } from '@/domain/escopo'
import type { AlvoApi } from './recebimentos'

export type TipoAprovacao = 'DESCONTO' | 'RETOMADA' | 'ACORDO'
export type StatusAprovacao = 'PENDENTE' | 'APROVADO' | 'RECUSADO'

export interface AprovacaoApi {
  id: number
  tipo: TipoAprovacao
  status: StatusAprovacao
  alvo: AlvoApi
  /** id da venda ou do empréstimo */
  operacaoId: number
  /** a parcela do desconto (a retomada é da venda toda: sem parcela) */
  parcela: number | null
  nParcelas: number
  /** desconto: o valor pedido. Retomada: o que estava em aberto na venda quando pediu. */
  valor: number
  /** só no pedido de acordo: o que o cobrador propôs */
  acordo: { parcelas: number; primeiraParcela: string; saldoNoPedido: number } | null
  motivo: string | null
  solicitante: { id: number; nome: string }
  cliente: { id: number; nome: string }
  aparelho: string
  criadaEm: string
  respondidoPor: string | null
  respondidoEm: string | null
  resposta: string | null
}

export interface ListaAprovacoes { itens: AprovacaoApi[]; total: number; pendentes: number; pagina: number; limite: number }

export interface AprovacoesApi {
  /** O cobrador pede (o administrador dá desconto direto ao receber). */
  pedirDesconto(s: Sessao, e: { alvo: AlvoApi; operacaoId: number; parcela: number; valor: number; motivo: string }): Promise<AprovacaoApi>
  /** O cobrador pede a retomada do aparelho de uma venda com parcela atrasada. */
  pedirRetomada(s: Sessao, e: { operacaoId: number; motivo: string }): Promise<AprovacaoApi>
  /** O cobrador propõe um acordo (renegociar o que falta em parcelas novas). */
  pedirAcordo(s: Sessao, e: { alvo: AlvoApi; operacaoId: number; valorTotal: number; parcelas: number; primeiraParcela: string; motivo: string }): Promise<AprovacaoApi>
  listar(s: Sessao, q: { status?: StatusAprovacao; pagina?: number; limite?: number }): Promise<ListaAprovacoes>
  aprovar(s: Sessao, id: number): Promise<AprovacaoApi>
  recusar(s: Sessao, id: number, motivo?: string): Promise<AprovacaoApi>
}
