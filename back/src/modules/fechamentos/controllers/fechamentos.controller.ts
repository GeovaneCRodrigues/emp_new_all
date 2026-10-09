import type { FastifyReply, FastifyRequest } from 'fastify'
import { naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { FechamentosService } from '../services/fechamentos.service.js'
import { caixaView, fechamentoView, listaView } from '../views/fechamentos.view.js'

const sessaoOuErro = (req: FastifyRequest) => req.sessao ?? (() => { throw naoAutenticado() })()
const numero = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : undefined)
function idDaRota(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id)
  if (!Number.isInteger(id) || id <= 0) throw requisicaoInvalida('Id inválido')
  return id
}

export function createFechamentosController(service: FechamentosService) {
  return {
    async hoje(req: FastifyRequest) { return caixaView(await service.hoje(sessaoOuErro(req))) },
    async fechar(req: FastifyRequest, reply: FastifyReply) { return reply.code(201).send(fechamentoView(await service.fechar(sessaoOuErro(req)))) },
    async listar(req: FastifyRequest) {
      const q = req.query as Record<string, unknown>
      return listaView(await service.listar(sessaoOuErro(req), { status: typeof q.status === 'string' ? q.status : undefined, pagina: numero(q.pagina), limite: numero(q.limite) }))
    },
    async conferir(req: FastifyRequest) { return fechamentoView(await service.conferir(sessaoOuErro(req), idDaRota(req))) },
    async reabrir(req: FastifyRequest, reply: FastifyReply) { await service.reabrir(sessaoOuErro(req), idDaRota(req)); return reply.code(204).send() },
  }
}
