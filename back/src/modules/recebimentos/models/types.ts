import type { EstadoParcela, ParcelaAberta } from '../services/calculo.js'

export type FormaPagamento = 'PIX' | 'DINHEIRO' | 'CARTAO'

/** Quem pode ver/mexer: admin em tudo; cobrador só nos clientes da carteira dele. */
export type EscopoRecebimentos = { tipo: 'TODOS' } | { tipo: 'CARTEIRA'; usuarioId: number }

export type VendaTravada = {
  id: number
  clienteId: number
  clienteNome: string
  clienteFone: string
  status: 'ATIVA' | 'QUITADA' | 'RETOMADA' | 'CANCELADA'
  dataVenda: string
  modelo: string
  nParcelas: number
}

/** O que o recibo mostra, tirado na hora do recebimento. */
export type ResumoRecibo = {
  tipo: 'PARCELAS' | 'ENTRADA'
  referencia: string
  /** quanto ainda falta na venda depois deste recebimento */
  faltaDepois: number
  proxima: { numero: number; valor: number; vencimento: string } | null
  restantes: number
  /** quando pagou menos e o resto ficou para outra data */
  ficaDevendo: { numero: number; valor: number; vencimento: string } | null
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
}

export type ReciboRegistro = TransacaoRegistro & { tipo: 'ENTRADA' | 'PARCELA'; vendaId: number | null; clienteNome: string; clienteFone: string; modelo: string; responsavelId: number | null }

export type PagamentoDaVenda = TransacaoRegistro & { tipo: 'ENTRADA' | 'PARCELA' }

export type RecebimentoDaTransacao = { id: number; vendaParcelaId: number; numero: number; vendaId: number; valor: number; antes: EstadoParcela | null }

export type LinhaCobranca = {
  vendaId: number
  numero: number
  nParcelas: number
  vencimento: string
  vencimentoOriginal: string | null
  valor: number
  pago: number
  falta: number
  cliente: { id: number; nome: string; fone: string }
  modelo: string
  ultimaTransacaoId: number | null
  ultimoRecebimentoEm: string | null
}

export type Aba = 'atrasadas' | 'hoje' | 'proximas' | 'recebidas'
export type ResultadoCobrancas = { itens: LinhaCobranca[]; total: number; valorTotal: number; contagens: { atrasadas: number; hoje: number; proximas: number } }

export type { EstadoParcela, ParcelaAberta }
