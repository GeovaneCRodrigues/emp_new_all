import type { FastifyRequest } from 'fastify'
import { naoAutenticado } from '../../../shared/errors.js'
import type { RelatoriosService } from '../services/relatorios.service.js'

export function createRelatoriosController(service: RelatoriosService) {
  return {
    async ver(req: FastifyRequest) {
      return service.ver(req.sessao ?? (() => { throw naoAutenticado() })())
    },
  }
}
