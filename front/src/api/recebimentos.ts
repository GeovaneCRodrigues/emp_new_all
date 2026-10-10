import type { Sessao } from '@/domain/escopo'
import type { EfeitoRecebimento, RestoPagamento } from '@/domain/recebimento'
import type { FormaPagamentoApi } from './vendas'

/** O que o dinheiro paga: uma venda de iPhone ou um empréstimo. */
export type AlvoApi = 'VENDA' | 'EMPRESTIMO'

export interface ReciboApi {
  id: number
  /** número de 6 dígitos */
  numero: string
  empresa: { nome: string; cnpj: string | null }
  cliente: { id: number; nome: string; fone: string }
  /** a venda ou o empréstimo que foi pago */
  operacao: AlvoApi
  /** "iPhone 15 Pro" ou "Empréstimo só juros" */
  aparelho: string
  valor: number
  forma: FormaPagamentoApi
  data: string
  recebidoPor: string
  desfeita: boolean
  referencia: string
  faltaDepois: number
  proxima: { numero: number; valor: number; vencimento: string } | null
  restantes: number
  ficaDevendo: { numero: number; valor: number; vencimento: string } | null
  /** só juros: o que passou do juro abateu o capital */
  amortizacao: { valor: number; capitalRestante: number } | null
  /** texto pronto para o WhatsApp do cliente */
  mensagem: string
}

export interface RegistradoApi { recibo: ReciboApi; efeitos: EfeitoRecebimento[]; quitada: boolean; pedidoDescontoId: number | null }

export interface PagamentoApi {
  transacaoId: number
  numero: string
  data: string
  forma: FormaPagamentoApi
  valor: number
  recebidoPor: string
  referencia: string
  tipo: 'ENTRADA' | 'PARCELA'
  desfeita: boolean
  podeDesfazer: boolean
}

export interface CobrancaApi {
  tipo: AlvoApi
  operacaoId: number
  parcela: number
  nParcelas: number
  vencimento: string
  vencimentoOriginal: string | null
  valor: number
  pago: number
  falta: number
  atrasoDias: number
  cliente: { id: number; nome: string; fone: string }
  aparelho: string
  ultimaTransacaoId: number | null
  ultimoRecebimentoEm: string | null
  /** o indicador avisou que recebeu esta parcela e a loja ainda não respondeu */
  baixaPendente: { id: number; valor: number; por: string } | null
}

export type AbaCobranca = 'atrasadas' | 'hoje' | 'proximas' | 'recebidas'

export interface ListaCobrancasApi {
  itens: CobrancaApi[]
  total: number
  valorTotal: number
  pagina: number
  limite: number
  contagens: { atrasadas: number; hoje: number; proximas: number }
}

/** O calendário do mês: as parcelas (pagas e em aberto) que vencem nele. */
export interface CronogramaApi {
  /** AAAA-MM */
  mes: string
  hoje: string
  itens: CobrancaApi[]
  /** o mês passou do limite de linhas e a lista veio cortada */
  cortado: boolean
}

export interface EntradaRecebimento {
  parcela: number
  valor: number
  forma: FormaPagamentoApi
  /** padrão: hoje (o cobrador só lança hoje) */
  data?: string
  /** obrigatório quando pagou menos que a parcela */
  resto?: RestoPagamento
  novoVencimento?: string
  /** só o cobrador: lança o pagamento, deixa o resto devendo e pede desconto do resto ao administrador */
  pedirDesconto?: { motivo: string }
}

export interface RecebimentosApi {
  registrar(s: Sessao, alvo: AlvoApi, operacaoId: number, e: EntradaRecebimento): Promise<RegistradoApi>
  recibo(s: Sessao, id: number): Promise<ReciboApi>
  pagamentos(s: Sessao, alvo: AlvoApi, operacaoId: number): Promise<PagamentoApi[]>
  desfazer(s: Sessao, transacaoId: number): Promise<void>
  cronograma(s: Sessao, q: { mes?: string; tipo?: AlvoApi; /** parte do nome do cliente (sem acento e sem maiúscula) */ busca?: string }): Promise<CronogramaApi>
  cobrancas(s: Sessao, q: { aba?: AbaCobranca; tipo?: AlvoApi; /** parte do nome do cliente (sem acento e sem maiúscula) */ busca?: string; pagina?: number; limite?: number }): Promise<ListaCobrancasApi>
}
