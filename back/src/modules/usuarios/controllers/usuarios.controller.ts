import type { FastifyRequest } from 'fastify'
import { naoAutenticado } from '../../../shared/errors.js'
import type { UsuariosService } from '../services/usuarios.service.js'
import { responsaveisView } from '../views/usuarios.view.js'

export function createUsuariosController(service: UsuariosService) {
  return {
    async responsaveis(req: FastifyRequest) {
      if (!req.sessao) throw naoAutenticado()
      return responsaveisView(await service.responsaveis(req.sessao))
    },
  }
}
