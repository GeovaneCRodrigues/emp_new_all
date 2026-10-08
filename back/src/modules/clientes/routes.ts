import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createClientesController } from './controllers/clientes.controller.js'
import type { ClientesService } from './services/clientes.service.js'

export function clientesRoutes(service: ClientesService, auth: preHandlerAsyncHookHandler) {
  const c = createClientesController(service)
  return async (app: FastifyInstance) => {
    // quem pode o quê fica no service (precisa do escopo); aqui só exige estar logado
    app.get('/clientes', { preHandler: auth }, c.listar)
    app.get('/clientes/:id', { preHandler: auth }, c.obter)
    app.post('/clientes', { preHandler: auth }, c.criar)
    app.patch('/clientes/:id', { preHandler: auth }, c.atualizar)
  }
}
