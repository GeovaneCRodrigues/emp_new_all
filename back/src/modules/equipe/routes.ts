import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createEquipeController } from './controllers/equipe.controller.js'
import type { EquipeService } from './services/equipe.service.js'

export function equipeRoutes(service: EquipeService, auth: preHandlerAsyncHookHandler) {
  const c = createEquipeController(service)
  const p = { preHandler: auth }
  return async (app: FastifyInstance) => {
    app.get('/equipe', p, c.listar)
    app.post('/equipe', { ...p, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, c.convidar)
    app.patch('/equipe/:id', p, c.atualizar)
  }
}
