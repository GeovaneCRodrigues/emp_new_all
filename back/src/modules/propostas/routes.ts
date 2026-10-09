import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createPropostasController } from './controllers/propostas.controller.js'
import type { PropostasService } from './services/propostas.service.js'

export function propostasRoutes(service: PropostasService, auth: preHandlerAsyncHookHandler, limitePorMinuto = 60) {
  const c = createPropostasController(service)
  const p = { preHandler: auth }
  const limite = { config: { rateLimit: { max: limitePorMinuto, timeWindow: '1 minute' } } }
  return async (app: FastifyInstance) => {
    // quem pode o quê fica no service; aqui só exige estar logado
    app.post('/propostas', { ...p, ...limite }, c.criar)
    app.get('/propostas', p, c.listar)
    app.get('/propostas/:id', p, c.obter)
    app.post('/propostas/:id/aceitar', { ...p, ...limite }, c.aceitar)
    app.post('/propostas/:id/recusar', { ...p, ...limite }, c.recusar)
    app.post('/propostas/:id/cancelar', { ...p, ...limite }, c.cancelar)
  }
}
