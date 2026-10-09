import type { Sessao } from '@/domain/escopo'
import type { ParcelaVendaApi } from './vendas'

export type ModalidadeApi = 'PARCELADO' | 'JUROS' | 'DIARIA'
export type StatusEmprestimo = 'ATIVA' | 'QUITADA' | 'CANCELADA'

/** Empréstimo como a API devolve. Capital, taxa e lucro só existem para o admin. */
export interface EmprestimoApi {
  id: number
  cliente: { id: number; nome: string }
  modalidade: ModalidadeApi
  dataEmprestimo: string
  observacoes: string | null
  nParcelas: number
  valorParcela: number
  /** o que o cliente paga no total */
  total: number
  recebido: number
  falta: number
  atrasadas: number
  status: StatusEmprestimo
  parcelas: ParcelaVendaApi[]
  indicador?: { id: number; nome: string } | null
  capital?: number
  taxa?: number
  lucroTotal?: number
  seuLucro?: number
  lucroRealizado?: number
  capitalDeVolta?: number
  percentualIndicador?: number
  parteIndicador?: number
}

export interface ResumoEmprestimosApi { aReceber: number; capitalNaRua?: number; lucroPorVir?: number }
export interface ListaEmprestimos { itens: EmprestimoApi[]; total: number; pagina: number; limite: number }

export interface EntradaEmprestimo {
  clienteId: number
  modalidade: ModalidadeApi
  capital: number
  /** % ao mês (parcelado e só juros) ou do período todo (diária) */
  taxa: number
  parcelas: number
  indicadorId?: number | null
  observacoes?: string
}

/** Modalidades já liberadas no sistema (as outras entram uma de cada vez). */
export const MODALIDADES_LIBERADAS: ModalidadeApi[] = ['PARCELADO', 'JUROS']

export interface EmprestimosApi {
  criar(s: Sessao, e: EntradaEmprestimo): Promise<EmprestimoApi>
  listar(s: Sessao, q: { status?: string; pagina?: number; limite?: number }): Promise<ListaEmprestimos>
  obter(s: Sessao, id: number): Promise<EmprestimoApi>
  resumo(s: Sessao): Promise<ResumoEmprestimosApi>
}
