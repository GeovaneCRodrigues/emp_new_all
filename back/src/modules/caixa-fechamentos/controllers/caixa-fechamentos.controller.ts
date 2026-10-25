import type { FastifyReply, FastifyRequest } from 'fastify'
import { naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { CaixaFechamentosService } from '../services/caixa-fechamentos.service.js'
import { fechamentoView, listaView, previaView } from '../views/caixa-fechamentos.view.js'

const sessaoOuErro = (req: FastifyRequest) => req.sessao ?? (() => { throw naoAutenticado() })()
function idDaRota(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id)
  if (!Number.isInteger(id) || id <= 0) throw requisicaoInvalida('Id inválido')
  return id
}

export function createCaixaFechamentosController(service: CaixaFechamentosService) {
  return {
    async listar(req: FastifyRequest) { return listaView(await service.listar(sessaoOuErro(req))) },
    async previa(req: FastifyRequest) { return previaView(await service.previa(sessaoOuErro(req), req.query as { dia?: unknown })) },
    async fechar(req: FastifyRequest, reply: FastifyReply) { return reply.code(201).send(fechamentoView(await service.fechar(sessaoOuErro(req), (req.body ?? {}) as Record<string, unknown>))) },
    async desfazer(req: FastifyRequest, reply: FastifyReply) { await service.desfazer(sessaoOuErro(req), idDaRota(req)); return reply.code(204).send() },
  }
}
