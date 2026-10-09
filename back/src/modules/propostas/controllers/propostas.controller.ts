import type { FastifyReply, FastifyRequest } from 'fastify'
import { naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { PropostasService } from '../services/propostas.service.js'

const sessaoOuErro = (req: FastifyRequest) => req.sessao ?? (() => { throw naoAutenticado() })()
const corpo = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>
function idDaRota(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id)
  if (!Number.isInteger(id) || id <= 0) throw requisicaoInvalida('Id inválido')
  return id
}
const numeroOpcional = (v: string | undefined, campo: string) => {
  if (v === undefined) return undefined
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) throw requisicaoInvalida(`${campo} inválido`)
  return n
}

export function createPropostasController(service: PropostasService) {
  return {
    async criar(req: FastifyRequest, reply: FastifyReply) { return reply.code(201).send(await service.criar(sessaoOuErro(req), corpo(req))) },
    async listar(req: FastifyRequest) {
      const q = (req.query ?? {}) as { status?: string; indicadorId?: string; pagina?: string; limite?: string }
      return service.listar(sessaoOuErro(req), { status: q.status, indicadorId: numeroOpcional(q.indicadorId, 'indicadorId'), pagina: Number(q.pagina) || undefined, limite: Number(q.limite) || undefined })
    },
    async obter(req: FastifyRequest) { return service.obter(sessaoOuErro(req), idDaRota(req)) },
    async aceitar(req: FastifyRequest) { return service.aceitar(sessaoOuErro(req), idDaRota(req), corpo(req)) },
    async recusar(req: FastifyRequest) { return service.recusar(sessaoOuErro(req), idDaRota(req), corpo(req)) },
    async cancelar(req: FastifyRequest) { return service.cancelar(sessaoOuErro(req), idDaRota(req)) },
  }
}
