export type ModalidadeEmprestimo = 'PARCELADO' | 'JUROS' | 'DIARIA'
export type Periodicidade = 'MENSAL' | 'QUINZENAL' | 'SEMANAL' | 'DIARIA'
export type StatusEmprestimo = 'ATIVA' | 'QUITADA' | 'CANCELADA'
/** Como o indicador participa. CAPITAL_PRIMEIRO: só depois que o capital voltou. JUROS_MENSAL (só juros): a cada pagamento, o % dele sobre os JUROS recebidos. */
export type ModoDivisao = 'CAPITAL_PRIMEIRO' | 'JUROS_MENSAL'

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
  /** NOVA: criada por um acordo. ENCERRADA: um acordo a encerrou (ficou só com o que já foi pago). */
  acordo: 'NOVA' | 'ENCERRADA' | null
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
  /** parcelado e diária: % de juros NO TOTAL (100% = o cliente paga o dobro). Só juros: % a cada parcela. */
  taxa: number
  periodicidade: Periodicidade
  /** só diária: o domingo não conta (padrão); falso = todos os dias, domingo inclusive */
  pulaDomingo: boolean
  status: StatusEmprestimo
  observacoes: string | null
  modoDivisao: ModoDivisao
  /** só juros: quanto do capital já foi pago adiantado (excedente dos recebimentos). Conta como dinheiro recebido. */
  amortizado: number
  parcelas: ParcelaEmprestimo[]
  /** unificação: os empréstimos que este juntou (ids), ou o empréstimo novo em que este foi juntado */
  unificadoDe: number[]
  unificadoEm: number | null
}

/** Quais empréstimos um pedido pode enxergar. */
export type EscopoEmprestimos = { tipo: 'TODOS' } | { tipo: 'CARTEIRA'; usuarioId: number } | { tipo: 'INDICADOR'; indicadorId: number }

export type NovoEmprestimo = {
  clienteId: number
  indicadorId: number | null
  pct: number
  dataEmprestimo: string
  capital: number
  modalidade: ModalidadeEmprestimo
  taxa: number
  periodicidade: Periodicidade
  pulaDomingo: boolean
  observacoes: string | null
  modoDivisao: ModoDivisao
  /** o dinheiro (ou parte dele) saiu da conta de um indicador, não do Caixa da loja */
  saiuDaConta: { indicadorId: number; valor: number } | null
}
