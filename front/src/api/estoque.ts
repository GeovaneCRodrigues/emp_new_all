import type { Sessao } from '@/domain/escopo'

export type EstadoAparelho = 'DISPONIVEL' | 'ENCOMENDADO' | 'VENDIDO'

/** Aparelho como a API devolve. Para o vendedor, `custo`, `extras` e `observacoes` nem existem. */
export interface AparelhoApi {
  id: number
  modelo: string
  gb: number
  cor: string
  bateria: number
  condicao: 'Novo' | 'Seminovo'
  /** só dígitos; opcional (uma encomenda ainda não tem) */
  imei: string | null
  preco: number
  estado: EstadoAparelho
  origem: 'COMPRA' | 'TROCA'
  dataCompra: string
  paraCliente: { id: number; nome: string } | null
  custo?: number
  extras?: number
  observacoes?: string | null
}

export interface ListaAparelhos { itens: AparelhoApi[]; total: number; pagina: number; limite: number }

export interface ResumoEstoqueApi {
  disponiveis: number
  encomendados: number
  valorEmVitrine: number
  /** só para o admin */
  capitalParado?: number
  margemMedia?: number
}

export interface EntradaAparelho {
  modelo?: string
  gb?: number
  cor?: string
  bateria?: number
  condicao?: 'Novo' | 'Seminovo'
  imei?: string | null
  custo?: number
  extras?: number
  preco?: number
  /** "vendido" não se escolhe: muda só pela venda */
  estado?: 'DISPONIVEL' | 'ENCOMENDADO'
  origem?: 'COMPRA' | 'TROCA'
  dataCompra?: string
  paraClienteId?: number | null
  observacoes?: string | null
}

export interface EstoqueApi {
  listar(s: Sessao, q: { busca?: string; estado?: EstadoAparelho; pagina?: number; limite?: number }): Promise<ListaAparelhos>
  resumo(s: Sessao): Promise<ResumoEstoqueApi>
  obter(s: Sessao, id: number): Promise<AparelhoApi>
  criar(s: Sessao, e: EntradaAparelho): Promise<AparelhoApi>
  atualizar(s: Sessao, id: number, e: EntradaAparelho): Promise<AparelhoApi>
}

/** Capital que o aparelho custou (custo + extras). Só existe para o admin. */
export const investidoApi = (a: AparelhoApi) => (a.custo ?? 0) + (a.extras ?? 0)
