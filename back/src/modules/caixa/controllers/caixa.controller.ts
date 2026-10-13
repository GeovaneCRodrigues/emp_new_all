import type { FastifyReply, FastifyRequest } from 'fastify'
import { naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { CaixaService } from '../services/caixa.service.js'
import { caixaView, lancamentoView } from '../views/caixa.view.js'

const sessaoOuErro = (req: FastifyRequest) => req.sessao ?? (() => { throw naoAutenticado() })()
const numero = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : undefined)
const corpo = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>
function idDaRota(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id)
  if (!Number.isInteger(id) || id <= 0) throw requisicaoInvalida('Id inválido')
  return id
}

export function createCaixaController(service: CaixaService) {
  return {
    async ver(req: FastifyRequest) {
      const q = req.query as Record<string, unknown>
      return caixaView(await service.ver(sessaoOuErro(req), { pagina: numero(q.pagina), limite: numero(q.limite), busca: typeof q.busca === 'string' ? q.busca : undefined }))
    },
    async lancar(req: FastifyRequest, reply: FastifyReply) { return reply.code(201).send(lancamentoView(await service.lancar(sessaoOuErro(req), corpo(req)))) },
    async editar(req: FastifyRequest) { return lancamentoView(await service.editar(sessaoOuErro(req), idDaRota(req), corpo(req))) },
    async excluir(req: FastifyRequest, reply: FastifyReply) { await service.excluir(sessaoOuErro(req), idDaRota(req)); return reply.code(204).send() },
  }
}
