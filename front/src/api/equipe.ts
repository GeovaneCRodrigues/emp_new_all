import type { Sessao } from '@/domain/escopo'

export interface PessoaApi {
  id: number
  nome: string
  email: string
  perfil: 'ADMIN' | 'VENDEDOR' | 'COBRADOR' | 'INDICADOR'
  fone: string | null
  ativo: boolean
  carteira: number
  comAtraso: number
  recebidoNoMes: number
  vendasNoMes: number
  pedidosPendentes: number
  /** cobrador: os indicadores que ele atende (só o que vem deles aparece para ele; nenhum = não vê nada) */
  indicadorIds?: number[]
  /** último login (ISO) ou null se nunca entrou */
  ultimoAcesso: string | null
  /** conta travada por excesso de tentativas de senha */
  bloqueado: boolean
  /** ainda não trocou a senha temporária */
  senhaTemporaria: boolean
}

export interface ConviteEntrada { nome: string; email: string; perfil: 'ADMIN' | 'VENDEDOR' | 'COBRADOR'; fone?: string | null; /** obrigatório para criar administrador */ confirmarAdmin?: boolean }
export interface ConviteCriado { id: number; email: string; senhaTemporaria: string }
export type EdicaoPessoa = { nome?: string; email?: string; fone?: string | null; ativo?: boolean; indicadorIds?: number[]; /** só entre vendedor e cobrador */ perfil?: 'VENDEDOR' | 'COBRADOR' }

export interface EquipeApi {
  listar(s: Sessao): Promise<PessoaApi[]>
  convidar(s: Sessao, e: ConviteEntrada): Promise<ConviteCriado>
  atualizar(s: Sessao, id: number, e: EdicaoPessoa): Promise<PessoaApi>
  /** Troca a senha por uma temporária (mostrada uma vez), destrava o login e derruba as sessões abertas. */
  redefinirSenha(s: Sessao, id: number): Promise<ConviteCriado>
}
