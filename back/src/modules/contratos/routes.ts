import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createContratosController } from './controllers/contratos.controller.js'
import type { ContratosService } from './services/contratos.service.js'

export function contratosRoutes(service: ContratosService, auth: preHandlerAsyncHookHandler) {
  const c = createContratosController(service)
  const p = { preHandler: auth }
  return async (app: FastifyInstance) => {
    // modelo e empresa são do administrador; vendedor lê e manda os contratos das vendas dele (as regras estão no serviço)
    app.get('/contratos/modelo', p, c.modelo)
    app.put('/contratos/modelo', p, c.salvarModelo)
    app.post('/contratos/modelo/previa', p, c.previa)
    app.get('/contratos/empresa', p, c.empresa)
    app.put('/contratos/empresa', p, c.salvarEmpresa)
    app.get('/contratos/venda/:vendaId', p, c.porVenda)
    app.post('/contratos/venda/:vendaId', p, c.gerar)
    app.get('/contratos', p, c.listar)
    app.get('/contratos/:id', p, c.obter)
    app.post('/contratos/:id/enviado', p, c.enviado)
    app.post('/contratos/:id/assinado', p, c.assinado)
    app.patch('/contratos/:id', p, c.seguro)
  }
}
