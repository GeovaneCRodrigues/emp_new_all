import type { FastifyReply, FastifyRequest } from 'fastify'
import { naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { IndicadoresService } from '../services/indicadores.service.js'
import { indicadorView, niveisView } from '../views/indicadores.view.js'

const sessaoOuErro = (req: FastifyRequest) => req.sessao ?? (() => { throw naoAutenticado() })()
const corpo = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>

function idDaRota(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id)
  if (!Number.isInteger(id) || id <= 0) throw requisicaoInvalida('Id inválido')
  return id
}

export function createIndicadoresController(service: IndicadoresService) {
  return {
    async listar(req: FastifyRequest) { return (await service.listar(sessaoOuErro(req))).map(indicadorView) },
    async obter(req: FastifyRequest) { return indicadorView(await service.obter(sessaoOuErro(req), idDaRota(req))) },
    async criar(req: FastifyRequest, reply: FastifyReply) { return reply.code(201).send(indicadorView(await service.criar(sessaoOuErro(req), corpo(req)))) },
    async atualizar(req: FastifyRequest) { return indicadorView(await service.atualizar(sessaoOuErro(req), idDaRota(req), corpo(req))) },
    async criarAcesso(req: FastifyRequest, reply: FastifyReply) {
      reply.header('cache-control', 'no-store') // a senha temporária não pode ficar em cache
      return reply.code(201).send(await service.criarAcesso(sessaoOuErro(req), idDaRota(req), corpo(req)))
    },
    async niveis(req: FastifyRequest) { return niveisView(await service.niveis(sessaoOuErro(req))) },
    async salvarNiveis(req: FastifyRequest) { return niveisView(await service.salvarNiveis(sessaoOuErro(req), corpo(req))) },
  }
}
