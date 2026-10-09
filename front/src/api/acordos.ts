import type { Sessao } from '@/domain/escopo'
import type { AlvoApi } from './recebimentos'

/** O que o servidor devolve ao fazer um acordo. */
export interface ResultadoAcordoApi {
  acordoId: number
  alvo: AlvoApi
  operacaoId: number
  saldoAntes: number
  valorTotal: number
  nParcelas: number
  primeiraParcela: string
  parcelasEncerradas: number
  substituiuAcordoId: number | null
}

export interface AcordoApi {
  id: number
  dataAcordo: string
  saldoAntes: number
  valorTotal: number
  nParcelas: number
  primeiraParcela: string
  motivo: string | null
  status: 'ATIVO' | 'SUBSTITUIDO'
  feitoPor: string | null
  /** o pedido do cobrador que originou o acordo, se foi o caso */
  aprovacaoId: number | null
}

export interface EntradaAcordo {
  valorTotal: number
  parcelas: number
  /** AAAA-MM-DD; as outras vencem mês a mês no mesmo dia */
  primeiraParcela: string
  motivo?: string
}

export interface AcordosApi {
  /** Só o administrador faz o acordo direto (o cobrador pede em /aprovacoes). */
  fazer(s: Sessao, alvo: AlvoApi, operacaoId: number, e: EntradaAcordo): Promise<ResultadoAcordoApi>
  listar(s: Sessao, alvo: AlvoApi, operacaoId: number): Promise<AcordoApi[]>
}
