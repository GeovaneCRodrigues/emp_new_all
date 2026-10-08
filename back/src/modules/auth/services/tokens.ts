import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { naoAutenticado } from '../../../shared/errors.js'
import { PERFIS, type Perfil, type Sessao } from '../../../shared/perfis.js'

export type TokensService = {
  /** token de acesso: curto, vai em todo pedido (`Authorization: Bearer`) */
  emitirAcesso(s: Sessao): string
  verificarAcesso(token: string): Sessao
}

export function createTokensService(secret: string, expiresIn: string): TokensService {
  return {
    emitirAcesso(s) {
      return jwt.sign({ perfil: s.perfil, indicadorId: s.indicadorId, sid: s.sessaoId }, secret, {
        subject: String(s.usuarioId), expiresIn: expiresIn as jwt.SignOptions['expiresIn'], algorithm: 'HS256',
      })
    },
    verificarAcesso(token) {
      try {
        const p = jwt.verify(token, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload
        const usuarioId = Number(p.sub)
        if (!Number.isInteger(usuarioId) || !PERFIS.includes(p.perfil as Perfil) || typeof p.sid !== 'string') throw new Error('payload inválido')
        return { sessaoId: p.sid, usuarioId, perfil: p.perfil as Perfil, indicadorId: typeof p.indicadorId === 'number' ? p.indicadorId : null }
      } catch {
        throw naoAutenticado('Sessão inválida ou expirada')
      }
    },
  }
}

// ---- refresh token: opaco, "<sessaoId>.<aleatório>"; no banco fica só o hash ----

export const novoSegredoRefresh = () => randomBytes(32).toString('base64url')
export const montarRefresh = (sessaoId: string, segredo: string) => `${sessaoId}.${segredo}`
export const hashRefresh = (segredo: string) => createHash('sha256').update(segredo).digest('hex')

/** Separa `<sessaoId>.<segredo>`; devolve null se o formato não é o nosso. */
export function lerRefresh(token: string): { sessaoId: string; segredo: string } | null {
  const i = token.indexOf('.')
  if (i <= 0) return null
  const sessaoId = token.slice(0, i)
  const segredo = token.slice(i + 1)
  if (!/^[0-9a-f-]{36}$/i.test(sessaoId) || segredo.length < 20 || segredo.length > 100) return null
  return { sessaoId, segredo }
}

export function hashesIguais(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
