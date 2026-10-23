import type { FastifyReply, FastifyRequest } from 'fastify'
import { naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { ContaIndicadorService } from '../services/conta-indicador.service.js'

const sessaoOuErro = (req: FastifyRequest) => req.sessao ?? (() => { throw naoAutenticado() })()
function idDaRota(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id)
  if (!Number.isInteger(id) || id <= 0) throw requisicaoInvalida('Id inválido')
  return id
}
const numero = (v: unknown) => (v === undefined ? undefined : Number(v))

export function createContaIndicadorController(service: ContaIndicadorService) {
  return {
    async saldos(req: FastifyRequest) { return service.saldos(sessaoOuErro(req)) },
    async ver(req: FastifyRequest) {
      const q = (req.query ?? {}) as { pagina?: string; limite?: string }
      return service.ver(sessaoOuErro(req), idDaRota(req), { pagina: numero(q.pagina), limite: numero(q.limite) })
    },
    async lancarEnvio(req: FastifyRequest, reply: FastifyReply) {
      return reply.code(201).send(await service.lancarEnvio(sessaoOuErro(req), idDaRota(req), (req.body ?? {}) as Record<string, unknown>))
    },
  }
}
