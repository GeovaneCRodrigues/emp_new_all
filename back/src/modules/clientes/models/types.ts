export type Cliente = {
  id: number
  nome: string
  /** só dígitos, com DDD */
  fone: string
  /** só dígitos */
  cpf: string | null
  rg: string | null
  endereco: string | null
  origem: string | null
  /** só o administrador vê e edita */
  email: string | null
  observacoes: string | null
  responsavelId: number | null
  /** o indicador que cadastrou o cliente (o cliente já nasce vinculado a ele) */
  indicadorId: number | null
  /** data do cadastro (YYYY-MM-DD) */
  desde: string
}

export type DadosCliente = Omit<Cliente, 'id' | 'desde'>

/** Quais clientes um pedido pode enxergar. Decidido no service a partir do perfil. */
export type EscopoClientes =
  | { tipo: 'TODOS' }
  | { tipo: 'CARTEIRA'; usuarioId: number }
  | { tipo: 'INDICADOR'; indicadorId: number }

export type FiltroClientes = { busca?: string; limite: number; offset: number }
