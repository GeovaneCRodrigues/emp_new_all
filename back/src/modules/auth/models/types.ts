import type { Perfil } from '../../../shared/perfis.js'

export type Usuario = {
  id: number
  nome: string
  email: string
  senhaHash: string
  perfil: Perfil
  indicadorId: number | null
  ativo: boolean
  falhasLogin: number
  bloqueadoAte: Date | null
}

export type SessaoRegistro = {
  id: string
  usuarioId: number
  refreshHash: string
  refreshHashAnterior: string | null
  expiraEm: Date
  revogadaEm: Date | null
  ip: string | null
  userAgent: string | null
  criadaEm: Date
  ultimoUsoEm: Date
}
