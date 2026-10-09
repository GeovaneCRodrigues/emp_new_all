import type { Sessao } from '@/domain/escopo'

export type StatusAprovacao = 'PENDENTE' | 'APROVADO' | 'RECUSADO'

export interface AprovacaoApi {
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

export interface ListaAprovacoes { itens: AprovacaoApi[]; total: number; pendentes: number; pagina: number; limite: number }

export interface AprovacoesApi {
  /** O cobrador pede (o administrador dá desconto direto ao receber). */
  pedirDesconto(s: Sessao, e: { vendaId: number; parcela: number; valor: number; motivo: string }): Promise<AprovacaoApi>
  listar(s: Sessao, q: { status?: StatusAprovacao; pagina?: number; limite?: number }): Promise<ListaAprovacoes>
  aprovar(s: Sessao, id: number): Promise<AprovacaoApi>
  recusar(s: Sessao, id: number, motivo?: string): Promise<AprovacaoApi>
}
