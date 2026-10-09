import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createRepassesController } from './controllers/repasses.controller.js'
import type { RepassesService } from './services/repasses.service.js'

export function repassesRoutes(service: RepassesService, auth: preHandlerAsyncHookHandler, limitePorMinuto = 60) {
  const c = createRepassesController(service)
  const p = { preHandler: auth }
  return async (app: FastifyInstance) => {
    // quem pode o quê fica no service; aqui só exige estar logado
    app.get('/repasses', p, c.resumo)
    app.get('/repasses/pagos', p, c.jaPagos)
    app.get('/indicadores/:id/repasse', p, c.detalhe)
    app.post('/indicadores/:id/repasses', { ...p, config: { rateLimit: { max: limitePorMinuto, timeWindow: '1 minute' } } }, c.pagar)
  }
}
