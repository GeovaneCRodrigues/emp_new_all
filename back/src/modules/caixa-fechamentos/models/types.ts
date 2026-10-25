import type { Movimento } from '../../caixa/models/types.js'

export type FechamentoLoja = { id: number; dia: string; obs: string | null; por: string; criadoEm: string }

export type EntradaSaida = { entrou: number; saiu: number }

/** O que entrou e saiu entre `de` e `ate`, para o dono conferir antes de fechar. */
export type PreviaFechamento = {
  de: string
  ate: string
  entrou: number
  saiu: number
  saldo: number
  porLado: Record<'EMPRESTIMO' | 'IPHONE' | 'SEM_LADO', EntradaSaida>
  itens: Movimento[]
  /** a lista passou do limite e veio cortada (os totais são sempre os do período todo) */
  cortado: boolean
}
