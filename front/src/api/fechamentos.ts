import type { Sessao } from '@/domain/escopo'
import type { FormaPagamentoApi } from './vendas'

export type StatusFechamento = 'PENDENTE' | 'CONFERIDO'

export interface FechamentoApi {
  id: number
  usuario: { id: number; nome: string }
  data: string
  totalDinheiro: number
  totalPix: number
  totalCartao: number
  total: number
  status: StatusFechamento
  conferidoPor: string | null
  conferidoEm: string | null
}

export interface RecebimentoDoDiaApi { transacaoId: number; numero: string; cliente: string; valor: number; forma: FormaPagamentoApi; referencia: string }

export interface CaixaApi {
  data: string
  dinheiro: number
  pix: number
  cartao: number
  total: number
  fechamento: FechamentoApi | null
  recebimentos: RecebimentoDoDiaApi[]
}

export interface ListaFechamentos { itens: FechamentoApi[]; total: number; pendentes: number; pagina: number; limite: number }

export interface FechamentosApi {
  /** O caixa do dia do cobrador: o que recebeu por forma, os recebimentos e se já fechou. */
  hoje(s: Sessao): Promise<CaixaApi>
  fechar(s: Sessao): Promise<FechamentoApi>
  listar(s: Sessao, q: { status?: StatusFechamento; pagina?: number; limite?: number }): Promise<ListaFechamentos>
  conferir(s: Sessao, id: number): Promise<FechamentoApi>
  reabrir(s: Sessao, id: number): Promise<void>
}
