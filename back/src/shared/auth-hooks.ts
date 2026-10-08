import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AuthService } from '../modules/auth/services/auth.service.js'
import type { TokensService } from '../modules/auth/services/tokens.js'
import { HttpError, naoAutenticado, semPermissao } from './errors.js'
import type { Perfil, Sessao } from './perfis.js'

const LIBERADAS_COM_SENHA_TEMPORARIA = new Set(['/api/auth/senha', '/api/auth/eu', '/api/auth/logout'])

declare module 'fastify' {
  interface FastifyRequest { sessao?: Sessao }
}

/**
 * Hook `preHandler`: exige `Authorization: Bearer <token>`, confere o token E se a sessão ainda vale
 * (assim o logout, a troca de senha e a desativação da conta têm efeito na hora). Preenche `request.sessao`.
 */
export function exigirAuth(tokens: TokensService, auth: AuthService) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const h = req.headers.authorization
    if (!h?.startsWith('Bearer ')) throw naoAutenticado()
    const s = tokens.verificarAcesso(h.slice(7))
    const u = await auth.validarSessao(s)
    // senha temporária: até trocar, só dá para trocar a senha, ver quem é e sair
    if (u.senhaTemporaria && !LIBERADAS_COM_SENHA_TEMPORARIA.has(req.routeOptions.url ?? '')) throw new HttpError(403, 'Troque a senha temporária para continuar', 'TROCAR_SENHA')
    req.sessao = s
  }
}

/** Hook `preHandler` (depois de `exigirAuth`): só deixa passar os perfis listados. */
export function exigirPerfil(...perfis: Perfil[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (!req.sessao) throw naoAutenticado()
    if (!perfis.includes(req.sessao.perfil)) throw semPermissao()
  }
}
