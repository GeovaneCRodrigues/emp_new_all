import type { FastifyReply, FastifyRequest } from 'fastify'
import { naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { RepassesService } from '../services/repasses.service.js'

const sessaoOuErro = (req: FastifyRequest) => req.sessao ?? (() => { throw naoAutenticado() })()
function idDaRota(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id)
  if (!Number.isInteger(id) || id <= 0) throw requisicaoInvalida('Id inválido')
  return id
}

export function createRepassesController(service: RepassesService) {
  return {
    async resumo(req: FastifyRequest) { return service.resumo(sessaoOuErro(req)) },
    async detalhe(req: FastifyRequest) { return service.detalhe(sessaoOuErro(req), idDaRota(req)) },
    async pagar(req: FastifyRequest, reply: FastifyReply) { return reply.code(201).send(await service.pagar(sessaoOuErro(req), idDaRota(req), (req.body ?? {}) as Record<string, unknown>)) },
    async jaPagos(req: FastifyRequest) {
      const q = (req.query ?? {}) as { indicadorId?: string }
      const id = q.indicadorId === undefined ? undefined : Number(q.indicadorId)
      if (id !== undefined && (!Number.isInteger(id) || id <= 0)) throw requisicaoInvalida('indicadorId inválido')
      return service.jaPagos(sessaoOuErro(req), id)
    },
  }
}
