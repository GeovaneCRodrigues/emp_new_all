import type { Credenciais } from '../services/auth.service.js'
import type { SessaoRegistro, Usuario } from '../models/types.js'

/** O que sai para o cliente. Nunca inclui o hash da senha nem dados de bloqueio. */
export const usuarioView = (u: Usuario) => ({ id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, indicadorId: u.indicadorId })

export const credenciaisView = (c: Credenciais) => ({
  accessToken: c.accessToken,
  refreshToken: c.refreshToken,
  refreshExpiraEm: c.expiraEm.toISOString(),
  usuario: usuarioView(c.usuario),
})

export const sessaoView = (s: SessaoRegistro, atualId: string) => ({
  id: s.id,
  atual: s.id === atualId,
  ip: s.ip,
  dispositivo: s.userAgent,
  criadaEm: s.criadaEm.toISOString(),
  ultimoUsoEm: s.ultimoUsoEm.toISOString(),
})
