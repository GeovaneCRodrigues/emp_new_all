export type TipoManual = 'APORTE' | 'RETIRADA' | 'DESPESA'

/** O caixa tem dois lados. Movimento sem lado (null): repasse de indicador e lançamento antigo que ainda não foi classificado. */
export type Lado = 'EMPRESTIMO' | 'IPHONE'
/** O filtro do extrato: um lado, só o que está sem lado, ou (sem filtro) tudo. */
export type FiltroLado = Lado | 'SEM_LADO'
export const LADOS: Lado[] = ['EMPRESTIMO', 'IPHONE']
export const FILTROS_LADO: FiltroLado[] = ['EMPRESTIMO', 'IPHONE', 'SEM_LADO']

/** De onde veio o movimento (o front escolhe o ícone e o texto por isso). */
export type CategoriaMovimento = 'RECEBIMENTO' | 'ENTRADA_VENDA' | 'TRANSFERENCIA' | 'APORTE' | 'RETIRADA' | 'DESPESA' | 'REPASSE' | 'EMPRESTIMO' | 'COMPRA'

export type Movimento = {
  /** identifica o movimento na lista (a origem + o id dela) */
  chave: string
  data: string
  valor: number
  /** true = entrou dinheiro; false = saiu */
  entrada: boolean
  categoria: CategoriaMovimento
  titulo: string
  sub: string
  lado: Lado | null
  /** só os lançamentos manuais (aporte, retirada, despesa) têm id: são os únicos que se editam e excluem */
  manualId: number | null
}

export type SaldoLado = { saldo: number; entrouMes: number; saiuMes: number; marcoZero: string | null }

export type ResumoCaixa = {
  /** a soma de tudo (cada lado contado a partir do seu marco zero) */
  saldo: number
  /** o dia do primeiro aporte/retirada: antes dele nada conta (null = sem lançamento manual, conta tudo) */
  marcoZero: string | null
  entrouMes: number
  saiuMes: number
  /** o mesmo resumo de cada lado */
  porLado: Record<FiltroLado, SaldoLado>
}

export type LancamentoManual = { id: number; tipo: TipoManual; valor: number; data: string; obs: string | null; lado: Lado | null }
export type NovoLancamento = { tipo: TipoManual; valor: number; data: string; obs: string | null; lado: Lado; usuarioId: number }
