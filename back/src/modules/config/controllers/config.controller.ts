import type { FastifyRequest } from 'fastify'
import { naoAutenticado } from '../../../shared/errors.js'
import type { ConfigService } from '../services/config.service.js'

export function createConfigController(service: ConfigService) {
  return {
    async juros(req: FastifyRequest) {
      if (!req.sessao) throw naoAutenticado()
      const j = await service.juros(req.sessao)
      return { pct: j.pct, maxParcelas: j.maxParcelas }
    },
  }
}
