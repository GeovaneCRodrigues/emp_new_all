import type { Sessao } from '@/domain/escopo'

export type TipoLancamento = 'APORTE' | 'RETIRADA' | 'DESPESA'

/** O caixa tem dois lados. Sem lado (null): repasse de indicador e lançamento antigo ainda não classificado. */
export type LadoCaixa = 'EMPRESTIMO' | 'IPHONE'
/** O filtro do extrato: um lado, só o que está sem lado, ou (sem filtro) tudo. */
export type FiltroLadoCaixa = LadoCaixa | 'SEM_LADO'

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
  lado: LadoCaixa | null
  /** só aporte, retirada e despesa têm id: são os únicos que se editam e excluem */
  manualId: number | null
}

export interface SaldoLadoApi { saldo: number; entrouMes: number; saiuMes: number; marcoZero: string | null }

export interface CaixaLojaApi {
  /** saldo, entrouMes, saiuMes e marcoZero são do lado pedido (sem filtro, de tudo); porLado traz sempre os três */
  saldo: number
  /** dia do primeiro aporte/retirada: antes dele nada conta (null = sem lançamento, conta tudo) */
  marcoZero: string | null
  entrouMes: number
  saiuMes: number
  porLado: Record<FiltroLadoCaixa, SaldoLadoApi>
  hoje: string
  /** AAAA-MM */
  mes: string
  itens: MovimentoApi[]
  total: number
  pagina: number
  limite: number
}

export interface LancamentoApi { id: number; tipo: TipoLancamento; valor: number; data: string; obs: string | null; lado: LadoCaixa | null }

export interface EntradaLancamento { tipo: TipoLancamento; lado: LadoCaixa; valor: number; /** padrão: hoje (não pode ser no futuro) */ data?: string; obs?: string }

export interface CaixaApi {
  /** O caixa da loja (só o administrador). */
  ver(s: Sessao, q?: { pagina?: number; limite?: number; busca?: string; lado?: FiltroLadoCaixa }): Promise<CaixaLojaApi>
  lancar(s: Sessao, e: EntradaLancamento): Promise<LancamentoApi>
  editar(s: Sessao, id: number, e: Partial<EntradaLancamento>): Promise<LancamentoApi>
  excluir(s: Sessao, id: number): Promise<void>
}
