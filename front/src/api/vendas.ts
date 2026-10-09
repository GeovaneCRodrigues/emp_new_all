import type { Sessao } from '@/domain/escopo'

export type StatusVenda = 'ATIVA' | 'QUITADA' | 'RETOMADA' | 'CANCELADA'
export type FormaPagamentoApi = 'PIX' | 'DINHEIRO' | 'CARTAO'

export interface ParcelaVendaApi {
  numero: number
  vencimento: string
  vencimentoOriginal: string | null
  valor: number
  desconto: number
  pago: number
  falta: number
  quitadaEm: string | null
  /** NOVA: criada por um acordo. ENCERRADA: um acordo a encerrou (ficou só com o que já foi pago). */
  acordo: 'NOVA' | 'ENCERRADA' | null
}

/** Venda como a API devolve. Os campos de custo e lucro só existem para o admin. */
export interface VendaApi {
  id: number
  aparelho: { id: number; modelo: string; gb: number; cor: string }
  cliente: { id: number; nome: string }
  indicador: { id: number; nome: string } | null
  dataVenda: string
  precoAcordado: number
  entrada: number
  troca: number
  jurosPct: number
  nParcelas: number
  valorParcela: number
  /** o que o cliente paga no total (entrada + troca + parcelas) */
  total: number
  recebido: number
  falta: number
  atrasadas: number
  status: StatusVenda
  contrato: 'AGUARDANDO' | 'ENVIADO' | 'ASSINADO'
  /** quando e por quê o aparelho foi retomado (só em venda RETOMADA) */
  retomada: { em: string; motivo: string | null } | null
  parcelas: ParcelaVendaApi[]
  custoNoDia?: number
  lucroTotal?: number
  seuLucro?: number
  lucroRealizado?: number
  capitalDeVolta?: number
  percentualIndicador?: number
  parteIndicador?: number
  /** só o indicador: a parte dele no lucro (prevista) e a que já foi liberada */
  suaParte?: number
  jaLiberado?: number
}

export interface ListaVendas { itens: VendaApi[]; total: number; pagina: number; limite: number }
export interface ResumoVendasApi { aReceber: number; capitalNaRua?: number; lucroPorVir?: number }

export interface TrocaEntrada {
  modelo: string
  gb: number
  cor: string
  bateria: number
  valor: number
  imei?: string | null
  precoRevenda?: number | null
}

export interface EntradaVenda {
  aparelhoId: number
  clienteId: number
  preco?: number
  entrada?: number
  formaEntrada?: FormaPagamentoApi
  troca?: TrocaEntrada | null
  parcelas?: number
  diaVencimento?: number
  indicadorId?: number | null
  /** só o admin escolhe; o vendedor vende sempre em nome dele */
  vendedorId?: number | null
}

export interface JurosApi { pct: number; maxParcelas: number }

export interface VendasApi {
  criar(s: Sessao, e: EntradaVenda): Promise<VendaApi>
  listar(s: Sessao, q: { status?: string; pagina?: number; limite?: number }): Promise<ListaVendas>
  obter(s: Sessao, id: number): Promise<VendaApi>
  resumo(s: Sessao): Promise<ResumoVendasApi>
  juros(s: Sessao): Promise<JurosApi>
  /** Retoma o aparelho de uma venda com parcela atrasada (só o administrador; o cobrador pede em /aprovacoes). */
  retomar(s: Sessao, id: number, e?: { motivo?: string }): Promise<VendaApi>
}
