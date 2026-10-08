import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createRecebimentosController } from './controllers/recebimentos.controller.js'
import type { RecebimentosService } from './services/recebimentos.service.js'

export function recebimentosRoutes(service: RecebimentosService, auth: preHandlerAsyncHookHandler, limitePorMinuto = 120) {
  const c = createRecebimentosController(service)
  const p = { preHandler: auth }
  const limite = { config: { rateLimit: { max: limitePorMinuto, timeWindow: '1 minute' } } }
  return async (app: FastifyInstance) => {
    // quem pode o quê fica no service; aqui só exige estar logado
    app.post('/vendas/:id/recebimentos', { ...p, ...limite }, c.registrar)
    app.get('/vendas/:id/pagamentos', p, c.pagamentos)
    app.get('/recibos/:id', p, c.recibo)
    app.post('/recebimentos/:id/desfazer', { ...p, ...limite }, c.desfazer)
    app.get('/cobrancas', p, c.cobrancas)
  }
}
