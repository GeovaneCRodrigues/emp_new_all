export const ESTADOS = ['DISPONIVEL', 'ENCOMENDADO', 'VENDIDO'] as const
export type EstadoAparelho = (typeof ESTADOS)[number]
export type Condicao = 'Novo' | 'Seminovo'
export type OrigemAparelho = 'COMPRA' | 'TROCA'

export type Aparelho = {
  id: number
  modelo: string
  gb: number
  cor: string
  bateria: number
  condicao: Condicao
  /** só dígitos; opcional (uma encomenda ainda não tem) */
  imei: string | null
  /** valor_compra: só o admin enxerga */
  custo: number
  /** custos_extras: só o admin enxerga */
  extras: number
  /** preço de venda */
  preco: number
  estado: EstadoAparelho
  origem: OrigemAparelho
  /** data da compra (YYYY-MM-DD) */
  dataCompra: string
  /** cliente que encomendou (quando estado = ENCOMENDADO) */
  paraCliente: { id: number; nome: string } | null
  observacoes: string | null
}

export type DadosAparelho = Omit<Aparelho, 'id' | 'paraCliente'> & { paraClienteId: number | null }

export type FiltroAparelhos = { busca?: string; estado?: EstadoAparelho; estados?: EstadoAparelho[]; limite: number; offset: number }

export type ResumoEstoque = {
  disponiveis: number
  encomendados: number
  /** soma de custo + extras dos disponíveis (só admin) */
  capitalParado: number
  /** soma dos preços de venda dos disponíveis */
  valorEmVitrine: number
  /** margem média dos disponíveis, em fração (só admin) */
  margemMedia: number
}
