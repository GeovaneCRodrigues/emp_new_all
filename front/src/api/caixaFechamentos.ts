import type { Sessao } from '@/domain/escopo'
import type { FiltroLadoCaixa, MovimentoApi } from './caixa'

/** O caixa da loja foi fechado até `dia`. Não guarda valores: só o dia, quem fechou e quando. */
export interface FechamentoLojaApi { id: number; dia: string; obs: string | null; por: string; criadoEm: string }

export interface ListaFechamentosLojaApi {
  hoje: string
  /** o fechamento mais recente (null: nunca fechou) */
  ultimo: FechamentoLojaApi | null
  /** quantos dias, até ontem, passaram sem fechar (null: nunca fechou) */
  diasSemFechar: number | null
  /** do mais recente para o mais antigo */
  itens: FechamentoLojaApi[]
}

/** O que entrou e saiu entre `de` e `ate`, para conferir antes de fechar. */
export interface PreviaFechamentoApi {
  de: string
  ate: string
  entrou: number
  saiu: number
  saldo: number
  porLado: Record<FiltroLadoCaixa, { entrou: number; saiu: number }>
  itens: MovimentoApi[]
  /** a lista passou do limite e veio cortada (os totais são sempre os do período todo) */
  cortado: boolean
}

export interface CaixaFechamentosApi {
  listar(s: Sessao): Promise<ListaFechamentosLojaApi>
  previa(s: Sessao, dia: string): Promise<PreviaFechamentoApi>
  fechar(s: Sessao, e: { dia: string; obs?: string }): Promise<FechamentoLojaApi>
  /** Só o último fechamento se desfaz. */
  desfazer(s: Sessao, id: number): Promise<void>
}
