import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createAprovacoesController } from './controllers/aprovacoes.controller.js'
import type { AprovacoesService } from './services/aprovacoes.service.js'

export function aprovacoesRoutes(service: AprovacoesService, auth: preHandlerAsyncHookHandler) {
  const c = createAprovacoesController(service)
  const p = { preHandler: auth }
  return async (app: FastifyInstance) => {
    app.get('/aprovacoes', p, c.listar)
    app.post('/aprovacoes', p, c.pedir)
    app.post('/aprovacoes/:id/aprovar', p, c.aprovar)
    app.post('/aprovacoes/:id/recusar', p, c.recusar)
  }
}
