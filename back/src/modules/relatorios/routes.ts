import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createRelatoriosController } from './controllers/relatorios.controller.js'
import type { RelatoriosService } from './services/relatorios.service.js'

export function relatoriosRoutes(service: RelatoriosService, auth: preHandlerAsyncHookHandler) {
  const c = createRelatoriosController(service)
  return async (app: FastifyInstance) => {
    // os relatórios mostram custo, lucro e capital da loja: só o administrador
    app.get('/relatorios', { preHandler: auth }, c.ver)
  }
}
