import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createEmprestimosController } from './controllers/emprestimos.controller.js'
import type { EmprestimosService } from './services/emprestimos.service.js'

export function emprestimosRoutes(service: EmprestimosService, auth: preHandlerAsyncHookHandler, limitePorMinuto = 60) {
  const c = createEmprestimosController(service)
  const p = { preHandler: auth }
  return async (app: FastifyInstance) => {
    // quem pode o quê fica no service; aqui só exige estar logado
    app.get('/emprestimos', p, c.listar)
    app.get('/emprestimos/resumo', p, c.resumo) // antes de /:id
    app.get('/emprestimos/:id', p, c.obter)
    app.post('/emprestimos', { ...p, config: { rateLimit: { max: limitePorMinuto, timeWindow: '1 minute' } } }, c.criar)
  }
}
