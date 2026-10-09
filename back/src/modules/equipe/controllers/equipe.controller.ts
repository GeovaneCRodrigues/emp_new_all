import type { FastifyReply, FastifyRequest } from 'fastify'
import { naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { EquipeService } from '../services/equipe.service.js'
import { listaView, pessoaView } from '../views/equipe.view.js'

const sessaoOuErro = (req: FastifyRequest) => req.sessao ?? (() => { throw naoAutenticado() })()
function idDaRota(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id)
  if (!Number.isInteger(id) || id <= 0) throw requisicaoInvalida('Id inválido')
  return id
}

export function createEquipeController(service: EquipeService) {
  return {
    async listar(req: FastifyRequest) { return listaView(await service.listar(sessaoOuErro(req))) },
    async convidar(req: FastifyRequest, reply: FastifyReply) {
      reply.header('cache-control', 'no-store') // a senha temporária não pode ficar em cache
      return reply.code(201).send(await service.convidar(sessaoOuErro(req), (req.body ?? {}) as Record<string, unknown>))
    },
    async atualizar(req: FastifyRequest) { return pessoaView(await service.atualizar(sessaoOuErro(req), idDaRota(req), (req.body ?? {}) as Record<string, unknown>)) },
  }
}
