import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createPushController } from './controllers/push.controller.js'
import type { PushService } from './services/push.service.js'

export function pushRoutes(service: PushService, auth: preHandlerAsyncHookHandler) {
  const c = createPushController(service)
  const p = { preHandler: auth }
  return async (app: FastifyInstance) => {
    // cada pessoa só mexe nos próprios aparelhos
    app.get('/push/config', p, c.config)
    app.post('/push/inscricao', p, c.inscrever)
    app.delete('/push/inscricao', p, c.cancelar)
    app.post('/push/teste', p, c.testar)
  }
}
