import type { FastifyReply, FastifyRequest } from 'fastify'
import { naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { NotificacoesService } from '../services/notificacoes.service.js'

const sessaoOuErro = (req: FastifyRequest) => req.sessao ?? (() => { throw naoAutenticado() })()

export function createNotificacoesController(service: NotificacoesService) {
  return {
    async listar(req: FastifyRequest) { return service.listar(sessaoOuErro(req)) },
    async marcarLida(req: FastifyRequest, reply: FastifyReply) {
      const id = Number((req.params as { id?: string }).id)
      if (!Number.isInteger(id) || id <= 0) throw requisicaoInvalida('Id inválido')
      await service.marcarLida(sessaoOuErro(req), id)
      return reply.code(204).send()
    },
    async marcarTodasLidas(req: FastifyRequest, reply: FastifyReply) { await service.marcarTodasLidas(sessaoOuErro(req)); return reply.code(204).send() },
  }
}
