import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createCaixaFechamentosController } from './controllers/caixa-fechamentos.controller.js'
import type { CaixaFechamentosService } from './services/caixa-fechamentos.service.js'

export function caixaFechamentosRoutes(service: CaixaFechamentosService, auth: preHandlerAsyncHookHandler) {
  const c = createCaixaFechamentosController(service)
  const p = { preHandler: auth }
  return async (app: FastifyInstance) => {
    // o fechamento do caixa da loja é só do administrador (o "fechar o dia" do cobrador é /fechamentos)
    app.get('/caixa/fechamentos', p, c.listar)
    app.get('/caixa/fechamentos/previa', p, c.previa)
    app.post('/caixa/fechamentos', p, c.fechar)
    app.delete('/caixa/fechamentos/:id', p, c.desfazer)
  }
}
