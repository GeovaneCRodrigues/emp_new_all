import type { Sessao } from '@/domain/escopo'
import type { Perfil } from '@/domain/types'

/** Cliente como a API devolve. O indicador recebe só id, nome, fone e desde (sem CPF, RG nem endereço). */
export interface ClienteApi {
  id: number
  nome: string
  /** só dígitos, com DDD */
  fone: string
  desde: string
  cpf?: string | null
  rg?: string | null
  endereco?: string | null
  origem?: string | null
  /** só o administrador recebe */
  email?: string | null
  observacoes?: string | null
  responsavelId?: number | null
  /** o indicador que cadastrou o cliente (só o administrador vê) */
  indicadorId?: number | null
}

export interface ListaClientes { itens: ClienteApi[]; total: number; pagina: number; limite: number }

export interface EntradaCliente {
  nome: string
  fone: string
  cpf?: string | null
  rg?: string | null
  endereco?: string | null
  origem?: string | null
  /** só o administrador grava (o vendedor e o indicador não enviam) */
  email?: string | null
  observacoes?: string | null
  /** só o administrador escolhe; o vendedor cadastra sempre na própria carteira */
  responsavelId?: number | null
}

export interface SalvoCliente { cliente: ClienteApi; avisos: string[] }
export interface Responsavel { id: number; nome: string; perfil: Perfil }

/** Erro devolvido pela API, com o status HTTP e o código (ex.: 409 CPF_DUPLICADO). */
export class ErroApi extends Error {
  constructor(public readonly status: number, message: string, public readonly codigo?: string) {
    super(message)
  }
}

export interface ClientesApi {
  listar(s: Sessao, q: { busca?: string; pagina?: number; limite?: number }): Promise<ListaClientes>
  obter(s: Sessao, id: number): Promise<ClienteApi>
  criar(s: Sessao, e: EntradaCliente): Promise<SalvoCliente>
  atualizar(s: Sessao, id: number, e: Partial<EntradaCliente>): Promise<SalvoCliente>
  responsaveis(s: Sessao): Promise<Responsavel[]>
}
