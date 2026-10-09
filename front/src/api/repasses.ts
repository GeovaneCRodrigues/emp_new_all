import type { Sessao } from '@/domain/escopo'
import type { OperacaoComRepasse, ValoresRepasse } from '@/domain/repasseIndicador'

export type FormaRepasse = 'PIX' | 'DINHEIRO' | 'TRANSFERENCIA'

export interface RepasseApi {
  id: number
  indicadorId: number
  indicadorNome: string
  valor: number
  data: string
  forma: FormaRepasse
  obs: string | null
  feitoPor: string | null
}

export interface ResumoDoIndicadorApi {
  indicador: { id: number; nome: string; chavePix: string | null; ativo: boolean }
  resumo: ValoresRepasse
  nOperacoes: number
}

export interface DetalheRepasseApi extends ResumoDoIndicadorApi {
  operacoes: OperacaoComRepasse[]
  repasses: RepasseApi[]
}

export interface EntradaRepasse { valor: number; forma: FormaRepasse; data?: string; obs?: string }

export interface RepassesApi {
  /** Todos os indicadores com a pagar / já pago / vai liberar (administrador). */
  resumo(s: Sessao): Promise<ResumoDoIndicadorApi[]>
  /** Um indicador por dentro (o indicador vê só o dele). */
  detalhe(s: Sessao, indicadorId: number): Promise<DetalheRepasseApi>
  pagar(s: Sessao, indicadorId: number, e: EntradaRepasse): Promise<{ repasse: RepasseApi; detalhe: DetalheRepasseApi }>
  jaPagos(s: Sessao, indicadorId?: number): Promise<RepasseApi[]>
}
