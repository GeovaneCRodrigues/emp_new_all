/** O que vem do MySQL do sistema antigo para as operações (já com datas em AAAA-MM-DD e números como número). */
export type ModalidadeAntiga = 'JUROS' | 'PARCELADO' | 'INVESTIMENTO/SOCIEDADE'
export type PeriodicidadeAntiga = 'DIARIA' | 'SEMANAL' | 'QUINZENAL' | 'MENSAL'

export interface OperacaoAntiga {
  id: number
  clienteId: number
  dataInicio: string
  diaVencimento: number
  modalidade: ModalidadeAntiga
  periodicidade: PeriodicidadeAntiga
  valorOriginal: number
  /** só juros: taxa por mês (0,28 = 28%) */
  taxaJurosMes: number
  /** parcelado e diária: o valor de CADA parcela; só juros: o juro de cada período */
  valorRecebimentoMensal: number
  qtdeParcelasRecuperacao: number
  qtdeParcelasLucro: number
  /** fração (0,5 = 50%) */
  percentualParceiro: number
  modoDivisaoParceiro: 'JUROS_MENSAL' | 'CAPITAL_PRIMEIRO' | null
  indicadorId: number | null
  status: string
  obs: string | null
  criadoEm: string | null
}

export interface RecebimentoAntigo {
  id: number
  /** "<operação>-<n>", "acordo-<acordo>-<n>", "<parcela>-spl-<recebimento>" ou "diaria-<operação>" */
  parcelaId: string
  operacaoId: number
  valor: number
  tipo: 'integral' | 'parcial' | 'quitacao'
  saldoRemanescente: number
  novaParcelaId: string | null
  prazoDias: number | null
  dataPagamento: string
  obs: string | null
  cobradoPor: 'OWNER' | 'INDICADOR'
  criadoEm: string | null
}

export interface ParcelaExtraAntiga {
  id: string
  operacaoId: number
  parcelaOrigemId: string
  parcelaNumero: number
  totalParcelas: number
  vencimentoIso: string
  valor: number
  /** 'ACORDO' ou 'SALDO PROPORCIONAL' */
  fase: string
  modalidade: string
}

export interface AcordoAntigo {
  id: number
  operacaoId: number
  valorTotal: number
  capitalAdicional: number
  qtdeParcelas: number
  valorParcela: number
  dataPrimeiraParcela: string
  diaVencimento: number
  periodicidade: PeriodicidadeAntiga
  dataAcordo: string
  obs: string | null
}

export interface QuitacaoAntiga {
  id: number
  recebimentoId: number
  operacaoId: number
  parcelaOrigemId: string
  valor: number
  dataPagamento: string
  obs: string | null
}

export type AjustesAntigos = Record<string, { valorAjustado: number; proporcional: boolean }>
export type VencimentosAntigos = Record<string, { vencimentoIso: string }>

export interface RepasseBaixaAntiga { id: number; recebimentoId: number; operacaoId: number; indicadorId: number; valor: number; dataRepasse: string; obs: string | null }
export interface RepassePagamentoAntigo { id: number; indicadorId: number; valor: number; dataPagamento: string; obs: string | null }
export interface TransferenciaAntiga { id: number; indicadorId: number; valor: number; dataTransferencia: string; obs: string | null }
export interface MovimentacaoCaixaAntiga { id: number; tipo: 'APORTE' | 'RETIRADA'; valor: number; data: string; obs: string | null }

/** Tudo o que o sistema antigo guarda sobre empréstimos, lido de uma vez. */
export interface EstadoAntigo {
  operacoes: OperacaoAntiga[]
  recebimentos: RecebimentoAntigo[]
  parcelasExtras: ParcelaExtraAntiga[]
  parcelaAjustes: AjustesAntigos
  parcelaVencimentos: VencimentosAntigos
  quitacoes: QuitacaoAntiga[]
  acordos: AcordoAntigo[]
  repassesBaixas: RepasseBaixaAntiga[]
  repassesPagamentos: RepassePagamentoAntigo[]
  transferencias: TransferenciaAntiga[]
  movimentacoesCaixa: MovimentacaoCaixaAntiga[]
}

/** Uma parcela como o sistema antigo a mostra (gerada em memória, com pagamentos, acordos e quitação aplicados). */
export interface ParcelaAntiga {
  id: string
  operacaoId: number
  numero: number
  totalParcelas: number
  vencimentoIso: string
  vencimentoOriginalIso?: string
  /** valor da parcela (já com o ajuste de baixa parcial, se houve) */
  valor: number
  valorOriginalParcela?: number
  fase: string
  status: 'PAGO' | 'PARCIAL' | 'VENCIDO' | 'A_VENCER'
  valorPago: number
  valorFalta: number
  /** a parcela que a quitação encerrou */
  quitacaoOperacao?: boolean
  /** veio de parcelas_extras (acordo ou saldo parcial) */
  extra: boolean
}
