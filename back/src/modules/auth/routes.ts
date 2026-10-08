import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createAuthController } from './controllers/auth.controller.js'
import type { AuthService } from './services/auth.service.js'

export function authRoutes(service: AuthService, auth: preHandlerAsyncHookHandler) {
  const c = createAuthController(service)
  // login e renovação são alvos de força bruta: poucas tentativas por minuto por IP
  const limite = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } })
  return async (app: FastifyInstance) => {
    app.post('/auth/login', limite(10), c.login)
    app.post('/auth/renovar', limite(30), c.renovar)
    app.post('/auth/logout', { preHandler: auth }, c.logout)
    app.post('/auth/logout-todas', { preHandler: auth }, c.logoutTodas)
    app.get('/auth/eu', { preHandler: auth }, c.eu)
    app.get('/auth/sessoes', { preHandler: auth }, c.sessoes)
    app.post('/auth/senha', { preHandler: auth, ...limite(5) }, c.trocarSenha)
  }
}
