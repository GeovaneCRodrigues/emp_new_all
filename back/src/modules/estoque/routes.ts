import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createEstoqueController } from './controllers/estoque.controller.js'
import type { EstoqueService } from './services/estoque.service.js'

export function estoqueRoutes(service: EstoqueService, auth: preHandlerAsyncHookHandler) {
  const c = createEstoqueController(service)
  const p = { preHandler: auth }
  return async (app: FastifyInstance) => {
    // quem pode o quê fica no service; aqui só exige estar logado
    app.get('/aparelhos', p, c.listar)
    app.get('/aparelhos/resumo', p, c.resumo) // antes de /:id, para "resumo" não ser lido como id
    app.get('/aparelhos/:id', p, c.obter)
    app.post('/aparelhos', p, c.criar)
    app.patch('/aparelhos/:id', p, c.atualizar)
  }
}
