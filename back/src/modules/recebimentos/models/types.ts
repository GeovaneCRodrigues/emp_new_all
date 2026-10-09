import type { EstadoParcela, ParcelaAberta } from '../services/calculo.js'

export type FormaPagamento = 'PIX' | 'DINHEIRO' | 'CARTAO'

/** Quem pode ver/mexer: admin em tudo; cobrador só nos clientes da carteira dele. */
export type EscopoRecebimentos = { tipo: 'TODOS' } | { tipo: 'CARTEIRA'; usuarioId: number }

/** O que o dinheiro paga: uma venda de iPhone ou um empréstimo. */
export type Alvo = 'VENDA' | 'EMPRESTIMO'

export type OperacaoTravada = {
  id: number
  alvo: Alvo
  clienteId: number
  clienteNome: string
  clienteFone: string
  status: 'ATIVA' | 'QUITADA' | 'RETOMADA' | 'CANCELADA'
  /** data da venda ou do empréstimo */
  data: string
  /** "iPhone 15 Pro" ou "Empréstimo só juros" (vai no recibo) */
  descricao: string
  nParcelas: number
  /** só empréstimo */
  modalidade: 'PARCELADO' | 'JUROS' | 'DIARIA' | null
  taxa: number | null
  /** empréstimo com acordo de pé: as parcelas deixam de seguir a regra própria do só juros */
  temAcordo: boolean
}

/** O que o recibo mostra, tirado na hora do recebimento. */
export type ResumoRecibo = {
  tipo: 'PARCELAS' | 'ENTRADA'
  referencia: string
  /** quanto ainda falta na operação depois deste recebimento */
  faltaDepois: number
  proxima: { numero: number; valor: number; vencimento: string } | null
  restantes: number
  /** quando pagou menos e o resto ficou para outra data */
  ficaDevendo: { numero: number; valor: number; vencimento: string } | null
  /** só juros: o que passou do juro abateu o capital */
  amortizacao?: { valor: number; capitalRestante: number }
}

export type TransacaoRegistro = {
  id: number
  numeroRecibo: number
  clienteId: number
  valorTotal: number
  forma: FormaPagamento
  data: string
  recebidoPor: number | null
  recebidoPorNome: string | null
  desfeita: boolean
  resumo: ResumoRecibo | null
  /** o que mudou fora da parcela paga (só juros) */
  ajustes: AjustesTransacao | null
}

export type AjustesTransacao = { amortizacao: number; parcelas: { parcelaId: number; numero: number; antes: EstadoParcela }[] }

export type ReciboRegistro = TransacaoRegistro & { tipo: 'ENTRADA' | 'PARCELA'; alvo: Alvo | null; operacaoId: number | null; clienteNome: string; clienteFone: string; descricao: string; responsavelId: number | null }

export type PagamentoDaOperacao = TransacaoRegistro & { tipo: 'ENTRADA' | 'PARCELA' }

export type RecebimentoDaTransacao = { id: number; parcelaId: number; numero: number; operacaoId: number; valor: number; antes: EstadoParcela | null; /** a parcela foi encerrada por um acordo depois deste pagamento */ encerradaPorAcordo: boolean }

export type LinhaCobranca = {
  tipo: Alvo
  operacaoId: number
  numero: number
  nParcelas: number
  vencimento: string
  vencimentoOriginal: string | null
  valor: number
  pago: number
  falta: number
  cliente: { id: number; nome: string; fone: string }
  descricao: string
  ultimaTransacaoId: number | null
  ultimoRecebimentoEm: string | null
}

export type Aba = 'atrasadas' | 'hoje' | 'proximas' | 'recebidas'
export type FiltroTipo = Alvo | undefined
export type ResultadoCobrancas = { itens: LinhaCobranca[]; total: number; valorTotal: number; contagens: { atrasadas: number; hoje: number; proximas: number } }

export type { EstadoParcela, ParcelaAberta }
