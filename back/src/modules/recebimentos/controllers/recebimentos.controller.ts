import type { FastifyReply, FastifyRequest } from 'fastify'
import { naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { Alvo } from '../models/types.js'
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
    registrar: (alvo: Alvo) => async (req: FastifyRequest, reply: FastifyReply) => {
      const r = await service.registrar(sessaoOuErro(req), alvo, idDaRota(req), (req.body ?? {}) as Record<string, unknown>)
      return reply.code(201).send(registradoView(r))
    },
    pagamentos: (alvo: Alvo) => async (req: FastifyRequest) => pagamentosView(await service.pagamentos(sessaoOuErro(req), alvo, idDaRota(req))),
    async recibo(req: FastifyRequest) { return reciboView(await service.recibo(sessaoOuErro(req), idDaRota(req))) },
    async desfazer(req: FastifyRequest, reply: FastifyReply) { await service.desfazer(sessaoOuErro(req), idDaRota(req)); return reply.code(204).send() },
    async cobrancas(req: FastifyRequest) {
      const q = req.query as Record<string, unknown>
      return cobrancasView(await service.cobrancas(sessaoOuErro(req), { aba: typeof q.aba === 'string' ? q.aba : undefined, tipo: typeof q.tipo === 'string' ? q.tipo : undefined, pagina: numero(q.pagina), limite: numero(q.limite) }))
    },
  }
}
