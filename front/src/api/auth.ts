import type { Perfil } from '@/domain/types'

export interface UsuarioAuth {
  id: number
  nome: string
  email: string
  perfil: Perfil
  indicadorId: number | null
}

export interface Credenciais {
  accessToken: string
  refreshToken: string
  usuario: UsuarioAuth
}

/** Erro de autenticação com o status HTTP (401 = senha errada/sessão vencida, 423 = conta bloqueada, 429 = muitas tentativas). */
export class ErroAuth extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

/** Contrato com `/api/auth/*` do backend. */
export interface AuthApi {
  login(email: string, senha: string): Promise<Credenciais>
  renovar(refreshToken: string): Promise<Credenciais>
  logout(accessToken: string): Promise<void>
  eu(accessToken: string): Promise<UsuarioAuth>
}
