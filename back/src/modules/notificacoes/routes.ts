import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createNotificacoesController } from './controllers/notificacoes.controller.js'
import type { NotificacoesService } from './services/notificacoes.service.js'

export function notificacoesRoutes(service: NotificacoesService, auth: preHandlerAsyncHookHandler) {
  const c = createNotificacoesController(service)
  const p = { preHandler: auth }
  return async (app: FastifyInstance) => {
    // cada pessoa só enxerga e mexe nos próprios avisos
    app.get('/notificacoes', p, c.listar)
    app.post('/notificacoes/lidas', p, c.marcarTodasLidas)
    app.post('/notificacoes/:id/lida', p, c.marcarLida)
  }
}
