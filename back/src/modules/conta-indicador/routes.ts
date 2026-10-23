import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createContaIndicadorController } from './controllers/conta-indicador.controller.js'
import type { ContaIndicadorService } from './services/conta-indicador.service.js'

export function contaIndicadorRoutes(service: ContaIndicadorService, auth: preHandlerAsyncHookHandler) {
  const c = createContaIndicadorController(service)
  const p = { preHandler: auth }
  return async (app: FastifyInstance) => {
    // quem pode o quê fica no service; aqui só exige estar logado
    app.get('/contas-indicadores', p, c.saldos)
    app.get('/indicadores/:id/conta', p, c.ver)
    app.post('/indicadores/:id/conta/envios', p, c.lancarEnvio)
  }
}
