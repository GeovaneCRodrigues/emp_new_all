import type { Sessao } from '@/domain/escopo'

export type TipoLancamento = 'APORTE' | 'RETIRADA' | 'DESPESA'

/** De onde veio o movimento: a tela escolhe o ícone por isso. */
export type CategoriaMovimentoApi = 'RECEBIMENTO' | 'ENTRADA_VENDA' | 'TRANSFERENCIA' | 'APORTE' | 'RETIRADA' | 'DESPESA' | 'REPASSE' | 'EMPRESTIMO' | 'COMPRA'

export interface MovimentoApi {
  chave: string
  data: string
  valor: number
  /** true = entrou dinheiro; false = saiu */
  entrada: boolean
  categoria: CategoriaMovimentoApi
  titulo: string
  sub: string
  /** só aporte, retirada e despesa têm id: são os únicos que se editam e excluem */
  manualId: number | null
}

export interface CaixaLojaApi {
  saldo: number
  /** dia do primeiro aporte/retirada: antes dele nada conta (null = sem lançamento, conta tudo) */
  marcoZero: string | null
  entrouMes: number
  saiuMes: number
  hoje: string
  /** AAAA-MM */
  mes: string
  itens: MovimentoApi[]
  total: number
  pagina: number
  limite: number
}

export interface LancamentoApi { id: number; tipo: TipoLancamento; valor: number; data: string; obs: string | null }

export interface EntradaLancamento { tipo: TipoLancamento; valor: number; /** padrão: hoje (não pode ser no futuro) */ data?: string; obs?: string }

export interface CaixaApi {
  /** O caixa da loja (só o administrador). */
  ver(s: Sessao, q?: { pagina?: number; limite?: number }): Promise<CaixaLojaApi>
  lancar(s: Sessao, e: EntradaLancamento): Promise<LancamentoApi>
  editar(s: Sessao, id: number, e: Partial<EntradaLancamento>): Promise<LancamentoApi>
  excluir(s: Sessao, id: number): Promise<void>
}
