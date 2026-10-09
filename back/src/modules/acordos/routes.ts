import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createAcordosController } from './controllers/acordos.controller.js'
import type { AcordosService } from './services/acordos.service.js'

export function acordosRoutes(service: AcordosService, auth: preHandlerAsyncHookHandler, limitePorMinuto = 60) {
  const c = createAcordosController(service)
  const p = { preHandler: auth }
  const limite = { config: { rateLimit: { max: limitePorMinuto, timeWindow: '1 minute' } } }
  return async (app: FastifyInstance) => {
    // quem pode o quê fica no service; aqui só exige estar logado
    app.post('/vendas/:id/acordos', { ...p, ...limite }, c.fazer('VENDA'))
    app.get('/vendas/:id/acordos', p, c.listar('VENDA'))
    app.post('/emprestimos/:id/acordos', { ...p, ...limite }, c.fazer('EMPRESTIMO'))
    app.get('/emprestimos/:id/acordos', p, c.listar('EMPRESTIMO'))
  }
}
