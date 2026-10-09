import type { FastifyReply, FastifyRequest } from 'fastify'
import { naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { AlvoAcordo } from '../models/acordo.js'
import type { AcordosService } from '../services/acordos.service.js'

const sessaoOuErro = (req: FastifyRequest) => req.sessao ?? (() => { throw naoAutenticado() })()
function idDaRota(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id)
  if (!Number.isInteger(id) || id <= 0) throw requisicaoInvalida('Id inválido')
  return id
}

export function createAcordosController(service: AcordosService) {
  return {
    fazer: (alvo: AlvoAcordo) => async (req: FastifyRequest, reply: FastifyReply) =>
      reply.code(201).send(await service.fazer(sessaoOuErro(req), alvo, idDaRota(req), (req.body ?? {}) as Record<string, unknown>)),
    listar: (alvo: AlvoAcordo) => async (req: FastifyRequest) => service.listar(sessaoOuErro(req), alvo, idDaRota(req)),
  }
}
