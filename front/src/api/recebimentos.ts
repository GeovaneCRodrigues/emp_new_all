import type { Sessao } from '@/domain/escopo'
import type { EfeitoRecebimento, RestoPagamento } from '@/domain/recebimento'
import type { FormaPagamentoApi } from './vendas'

export interface ReciboApi {
  id: number
  /** número de 6 dígitos */
  numero: string
  empresa: { nome: string; cnpj: string | null }
  cliente: { id: number; nome: string; fone: string }
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
  /** texto pronto para o WhatsApp do cliente */
  mensagem: string
}

export interface RegistradoApi { recibo: ReciboApi; efeitos: EfeitoRecebimento[]; vendaQuitada: boolean }

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
  vendaId: number
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

export interface EntradaRecebimento {
  parcela: number
  valor: number
  forma: FormaPagamentoApi
  /** padrão: hoje (o cobrador só lança hoje) */
  data?: string
  /** obrigatório quando pagou menos que a parcela */
  resto?: RestoPagamento
  novoVencimento?: string
}

export interface RecebimentosApi {
  registrar(s: Sessao, vendaId: number, e: EntradaRecebimento): Promise<RegistradoApi>
  recibo(s: Sessao, id: number): Promise<ReciboApi>
  pagamentos(s: Sessao, vendaId: number): Promise<PagamentoApi[]>
  desfazer(s: Sessao, transacaoId: number): Promise<void>
  cobrancas(s: Sessao, q: { aba?: AbaCobranca; pagina?: number; limite?: number }): Promise<ListaCobrancasApi>
}
