import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createFechamentosController } from './controllers/fechamentos.controller.js'
import type { FechamentosService } from './services/fechamentos.service.js'

export function fechamentosRoutes(service: FechamentosService, auth: preHandlerAsyncHookHandler) {
  const c = createFechamentosController(service)
  const p = { preHandler: auth }
  return async (app: FastifyInstance) => {
    app.get('/caixa/hoje', p, c.hoje)
    app.get('/fechamentos', p, c.listar)
    app.post('/fechamentos', p, c.fechar)
    app.post('/fechamentos/:id/conferir', p, c.conferir)
    app.post('/fechamentos/:id/reabrir', p, c.reabrir)
  }
}
