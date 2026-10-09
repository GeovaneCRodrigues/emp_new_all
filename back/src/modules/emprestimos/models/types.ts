export type ModalidadeEmprestimo = 'PARCELADO' | 'JUROS' | 'DIARIA'
export type StatusEmprestimo = 'ATIVA' | 'QUITADA' | 'CANCELADA'

export type ParcelaEmprestimo = {
  id: number
  numero: number
  vencimento: string
  /** vencimento antes de uma remarcação */
  vencimentoOriginal: string | null
  valor: number
  desconto: number
  quitadaEm: string | null
  /** quanto já entrou nesta parcela (recebimentos não desfeitos) */
  pago: number
}

export type Emprestimo = {
  id: number
  cliente: { id: number; nome: string }
  indicador: { id: number; nome: string } | null
  /** % do indicador congelado na hora do empréstimo (fração) */
  pct: number
  dataEmprestimo: string
  capital: number
  modalidade: ModalidadeEmprestimo
  /** % ao mês (parcelado e só juros) ou do período todo (diária) */
  taxa: number
  status: StatusEmprestimo
  observacoes: string | null
  parcelas: ParcelaEmprestimo[]
}

/** Quais empréstimos um pedido pode enxergar. */
export type EscopoEmprestimos = { tipo: 'TODOS' } | { tipo: 'CARTEIRA'; usuarioId: number }

export type NovoEmprestimo = {
  clienteId: number
  indicadorId: number | null
  pct: number
  dataEmprestimo: string
  capital: number
  modalidade: ModalidadeEmprestimo
  taxa: number
  observacoes: string | null
}
