import type { FastifyReply, FastifyRequest } from 'fastify'
import { naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { AuthService, Contexto } from '../services/auth.service.js'
import { credenciaisView, sessaoView, usuarioView } from '../views/auth.view.js'

const texto = (v: unknown) => (typeof v === 'string' ? v : '')
const contexto = (req: FastifyRequest): Contexto => ({ ip: req.ip ?? null, userAgent: (req.headers['user-agent'] as string | undefined) ?? null })
const sessaoOuErro = (req: FastifyRequest) => req.sessao ?? (() => { throw naoAutenticado() })()

export function createAuthController(service: AuthService) {
  return {
    async login(req: FastifyRequest) {
      const b = (req.body ?? {}) as Record<string, unknown>
      const email = texto(b.email).trim(), senha = texto(b.senha)
      if (!email || !senha) throw requisicaoInvalida('Informe e-mail e senha')
      return credenciaisView(await service.login(email, senha, contexto(req)))
    },

    async renovar(req: FastifyRequest) {
      const refresh = texto(((req.body ?? {}) as Record<string, unknown>).refreshToken)
      if (!refresh) throw requisicaoInvalida('Informe o refreshToken')
      return credenciaisView(await service.renovar(refresh, contexto(req)))
    },

    async logout(req: FastifyRequest, reply: FastifyReply) {
      await service.logout(sessaoOuErro(req).sessaoId)
      return reply.code(204).send()
    },

    async logoutTodas(req: FastifyRequest, reply: FastifyReply) {
      await service.logoutTodas(sessaoOuErro(req).usuarioId)
      return reply.code(204).send()
    },

    async eu(req: FastifyRequest) {
      const s = sessaoOuErro(req)
      return usuarioView(await service.validarSessao(s))
    },

    async sessoes(req: FastifyRequest) {
      const s = sessaoOuErro(req)
      return (await service.listarSessoes(s.usuarioId)).map((x) => sessaoView(x, s.sessaoId))
    },

    async trocarSenha(req: FastifyRequest, reply: FastifyReply) {
      const b = (req.body ?? {}) as Record<string, unknown>
      const atual = texto(b.senhaAtual), nova = texto(b.novaSenha)
      if (!atual || !nova) throw requisicaoInvalida('Informe a senha atual e a nova')
      await service.trocarSenha(sessaoOuErro(req), atual, nova)
      return reply.code(204).send()
    },
  }
}
