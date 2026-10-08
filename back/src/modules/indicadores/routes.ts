import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createIndicadoresController } from './controllers/indicadores.controller.js'
import type { IndicadoresService } from './services/indicadores.service.js'

export function indicadoresRoutes(service: IndicadoresService, auth: preHandlerAsyncHookHandler) {
  const c = createIndicadoresController(service)
  const p = { preHandler: auth }
  return async (app: FastifyInstance) => {
    // quem pode o quê está no service: aqui só exige estar logado
    app.get('/indicadores', p, c.listar)
    app.post('/indicadores', p, c.criar)
    app.get('/indicadores/opcoes', p, c.opcoes) // antes de /:id
    app.get('/indicadores/:id', p, c.obter)
    app.patch('/indicadores/:id', p, c.atualizar)
    app.post('/indicadores/:id/acesso', { ...p, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, c.criarAcesso)
    app.get('/niveis', p, c.niveis)
    app.put('/niveis', p, c.salvarNiveis)
  }
}
