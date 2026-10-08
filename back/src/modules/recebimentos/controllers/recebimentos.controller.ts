import type { FastifyReply, FastifyRequest } from 'fastify'
import { naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { RecebimentosService } from '../services/recebimentos.service.js'
import { cobrancasView, pagamentosView, registradoView, reciboView } from '../views/recebimentos.view.js'

const sessaoOuErro = (req: FastifyRequest) => req.sessao ?? (() => { throw naoAutenticado() })()
const numero = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : undefined)
function idDaRota(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id)
  if (!Number.isInteger(id) || id <= 0) throw requisicaoInvalida('Id inválido')
  return id
}

export function createRecebimentosController(service: RecebimentosService) {
  return {
    async registrar(req: FastifyRequest, reply: FastifyReply) {
      const r = await service.registrar(sessaoOuErro(req), idDaRota(req), (req.body ?? {}) as Record<string, unknown>)
      return reply.code(201).send(registradoView(r))
    },
    async pagamentos(req: FastifyRequest) { return pagamentosView(await service.pagamentos(sessaoOuErro(req), idDaRota(req))) },
    async recibo(req: FastifyRequest) { return reciboView(await service.recibo(sessaoOuErro(req), idDaRota(req))) },
    async desfazer(req: FastifyRequest, reply: FastifyReply) { await service.desfazer(sessaoOuErro(req), idDaRota(req)); return reply.code(204).send() },
    async cobrancas(req: FastifyRequest) {
      const q = req.query as Record<string, unknown>
      return cobrancasView(await service.cobrancas(sessaoOuErro(req), { aba: typeof q.aba === 'string' ? q.aba : undefined, pagina: numero(q.pagina), limite: numero(q.limite) }))
    },
  }
}
