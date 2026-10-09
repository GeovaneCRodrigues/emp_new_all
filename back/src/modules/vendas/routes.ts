import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createVendasController } from './controllers/vendas.controller.js'
import type { VendasService } from './services/vendas.service.js'

/** `limitePorMinuto`: quantas vendas por minuto cada IP pode criar (freio contra abuso e erro de script). */
export function vendasRoutes(service: VendasService, auth: preHandlerAsyncHookHandler, limitePorMinuto = 60) {
  const c = createVendasController(service)
  const p = { preHandler: auth }
  return async (app: FastifyInstance) => {
    // quem pode o quê fica no service; aqui só exige estar logado
    app.get('/vendas', p, c.listar)
    app.get('/vendas/resumo', p, c.resumo) // antes de /:id
    app.get('/vendas/:id', p, c.obter)
    app.post('/vendas/:id/retomar', { ...p, config: { rateLimit: { max: limitePorMinuto, timeWindow: '1 minute' } } }, c.retomar)
    app.post('/vendas', { ...p, config: { rateLimit: { max: limitePorMinuto, timeWindow: '1 minute' } } }, c.criar)
  }
}
