import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createCaixaController } from './controllers/caixa.controller.js'
import type { CaixaService } from './services/caixa.service.js'

export function caixaRoutes(service: CaixaService, auth: preHandlerAsyncHookHandler) {
  const c = createCaixaController(service)
  const p = { preHandler: auth }
  return async (app: FastifyInstance) => {
    // o caixa da loja é só do administrador (o do cobrador é /caixa/hoje, em fechamentos)
    app.get('/caixa', p, c.ver)
    app.post('/caixa/movimentos', p, c.lancar)
    app.patch('/caixa/movimentos/:id', p, c.editar)
    app.delete('/caixa/movimentos/:id', p, c.excluir)
  }
}
