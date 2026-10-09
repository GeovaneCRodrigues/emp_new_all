import type { FastifyReply, FastifyRequest } from 'fastify'
import { naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { EmprestimosService } from '../services/emprestimos.service.js'
import { emprestimoView, listaView, resumoView } from '../views/emprestimos.view.js'

const sessaoOuErro = (req: FastifyRequest) => req.sessao ?? (() => { throw naoAutenticado() })()
const numero = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : undefined)

function idDaRota(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id)
  if (!Number.isInteger(id) || id <= 0) throw requisicaoInvalida('Id inválido')
  return id
}

export function createEmprestimosController(service: EmprestimosService) {
  return {
    async listar(req: FastifyRequest) {
      const s = sessaoOuErro(req)
      const q = req.query as Record<string, unknown>
      return listaView(await service.listar(s, { status: typeof q.status === 'string' ? q.status : undefined, pagina: numero(q.pagina), limite: numero(q.limite) }), s.perfil)
    },
    async resumo(req: FastifyRequest) { const s = sessaoOuErro(req); return resumoView(await service.resumo(s), s.perfil) },
    async obter(req: FastifyRequest) { const s = sessaoOuErro(req); return emprestimoView(await service.obter(s, idDaRota(req)), s.perfil) },
    async criar(req: FastifyRequest, reply: FastifyReply) {
      const s = sessaoOuErro(req)
      return reply.code(201).send(emprestimoView(await service.criar(s, (req.body ?? {}) as Record<string, unknown>), s.perfil))
    },
  }
}
