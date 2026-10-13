export type TipoManual = 'APORTE' | 'RETIRADA' | 'DESPESA'

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
  /** só os lançamentos manuais (aporte, retirada, despesa) têm id: são os únicos que se editam e excluem */
  manualId: number | null
}

export type ResumoCaixa = {
  saldo: number
  /** o dia do primeiro aporte/retirada: antes dele nada conta (null = sem lançamento manual, conta tudo) */
  marcoZero: string | null
  entrouMes: number
  saiuMes: number
}

export type LancamentoManual = { id: number; tipo: TipoManual; valor: number; data: string; obs: string | null }
export type NovoLancamento = { tipo: TipoManual; valor: number; data: string; obs: string | null; usuarioId: number }
