import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createUsuariosController } from './controllers/usuarios.controller.js'
import type { UsuariosService } from './services/usuarios.service.js'

export function usuariosRoutes(service: UsuariosService, auth: preHandlerAsyncHookHandler) {
  const c = createUsuariosController(service)
  return async (app: FastifyInstance) => {
    app.get('/usuarios/responsaveis', { preHandler: auth }, c.responsaveis)
  }
}
