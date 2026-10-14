import type { PeriodicidadeAcordo } from '@/domain/acordo'
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
  periodicidade: PeriodicidadeAcordo
  parcelasEncerradas: number
  substituiuAcordoId: number | null
  /** dinheiro novo emprestado junto (já somado no capital do empréstimo) */
  capitalAdicional: number
}

export interface AcordoApi {
  id: number
  dataAcordo: string
  saldoAntes: number
  valorTotal: number
  nParcelas: number
  primeiraParcela: string
  periodicidade: PeriodicidadeAcordo
  motivo: string | null
  /** dinheiro novo emprestado junto com o acordo (já somado no capital do empréstimo) */
  capitalAdicional: number
  status: 'ATIVO' | 'SUBSTITUIDO'
  feitoPor: string | null
  /** o pedido do cobrador que originou o acordo, se foi o caso */
  aprovacaoId: number | null
}

export interface EntradaAcordo {
  valorTotal: number
  parcelas: number
  /** AAAA-MM-DD; as outras vencem na periodicidade escolhida */
  primeiraParcela: string
  /** omitido = mensal; venda de iPhone só mensal; diária é de segunda a sábado */
  periodicidade?: PeriodicidadeAcordo
  motivo?: string
  /** só empréstimo: dinheiro novo emprestado junto; soma no capital e sai do Caixa na data do acordo */
  capitalAdicional?: number
}

export interface AcordosApi {
  /** Só o administrador faz o acordo direto (o cobrador pede em /aprovacoes). */
  fazer(s: Sessao, alvo: AlvoApi, operacaoId: number, e: EntradaAcordo): Promise<ResultadoAcordoApi>
  listar(s: Sessao, alvo: AlvoApi, operacaoId: number): Promise<AcordoApi[]>
}
