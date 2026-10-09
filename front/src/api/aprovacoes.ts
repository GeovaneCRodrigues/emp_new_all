import type { Sessao } from '@/domain/escopo'
import type { AlvoApi } from './recebimentos'

export type StatusAprovacao = 'PENDENTE' | 'APROVADO' | 'RECUSADO'

export interface AprovacaoApi {
  id: number
  tipo: 'DESCONTO'
  status: StatusAprovacao
  alvo: AlvoApi
  /** id da venda ou do empréstimo */
  operacaoId: number
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

export interface ListaAprovacoes { itens: AprovacaoApi[]; total: number; pendentes: number; pagina: number; limite: number }

export interface AprovacoesApi {
  /** O cobrador pede (o administrador dá desconto direto ao receber). */
  pedirDesconto(s: Sessao, e: { alvo: AlvoApi; operacaoId: number; parcela: number; valor: number; motivo: string }): Promise<AprovacaoApi>
  listar(s: Sessao, q: { status?: StatusAprovacao; pagina?: number; limite?: number }): Promise<ListaAprovacoes>
  aprovar(s: Sessao, id: number): Promise<AprovacaoApi>
  recusar(s: Sessao, id: number, motivo?: string): Promise<AprovacaoApi>
}
