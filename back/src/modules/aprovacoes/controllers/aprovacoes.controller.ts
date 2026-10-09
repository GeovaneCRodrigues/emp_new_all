import type { FastifyReply, FastifyRequest } from 'fastify'
import { naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { AprovacoesService } from '../services/aprovacoes.service.js'
import { aprovacaoView, listaView } from '../views/aprovacoes.view.js'

const sessaoOuErro = (req: FastifyRequest) => req.sessao ?? (() => { throw naoAutenticado() })()
const numero = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : undefined)
function idDaRota(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id)
  if (!Number.isInteger(id) || id <= 0) throw requisicaoInvalida('Id inválido')
  return id
}

export function createAprovacoesController(service: AprovacoesService) {
  return {
    async pedir(req: FastifyRequest, reply: FastifyReply) { return reply.code(201).send(aprovacaoView(await service.pedirDesconto(sessaoOuErro(req), (req.body ?? {}) as Record<string, unknown>))) },
    async listar(req: FastifyRequest) {
      const q = req.query as Record<string, unknown>
      return listaView(await service.listar(sessaoOuErro(req), { status: typeof q.status === 'string' ? q.status : undefined, pagina: numero(q.pagina), limite: numero(q.limite) }))
    },
    async aprovar(req: FastifyRequest) { return aprovacaoView(await service.aprovar(sessaoOuErro(req), idDaRota(req))) },
    async recusar(req: FastifyRequest) { return aprovacaoView(await service.recusar(sessaoOuErro(req), idDaRota(req), (req.body ?? {}) as Record<string, unknown>)) },
  }
}
