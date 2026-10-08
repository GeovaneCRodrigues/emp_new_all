import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createConfigController } from './controllers/config.controller.js'
import type { ConfigService } from './services/config.service.js'

export function configRoutes(service: ConfigService, auth: preHandlerAsyncHookHandler) {
  const c = createConfigController(service)
  return async (app: FastifyInstance) => {
    app.get('/config/juros', { preHandler: auth }, c.juros)
  }
}
