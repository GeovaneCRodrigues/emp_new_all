import type { Sessao } from '@/domain/escopo'

export interface PessoaApi {
  id: number
  nome: string
  email: string
  perfil: 'ADMIN' | 'VENDEDOR' | 'COBRADOR'
  fone: string | null
  ativo: boolean
  carteira: number
  comAtraso: number
  recebidoNoMes: number
  vendasNoMes: number
  pedidosPendentes: number
}

export interface ConviteEntrada { nome: string; email: string; perfil: 'VENDEDOR' | 'COBRADOR'; fone?: string | null }
export interface ConviteCriado { id: number; email: string; senhaTemporaria: string }

export interface EquipeApi {
  listar(s: Sessao): Promise<PessoaApi[]>
  convidar(s: Sessao, e: ConviteEntrada): Promise<ConviteCriado>
  atualizar(s: Sessao, id: number, e: { nome?: string; fone?: string | null; ativo?: boolean }): Promise<PessoaApi>
}
