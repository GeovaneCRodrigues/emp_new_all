import type { FastifyReply, FastifyRequest } from 'fastify'
import { naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { EstoqueService } from '../services/estoque.service.js'
import { aparelhoView, listaView, resumoView } from '../views/estoque.view.js'

const sessaoOuErro = (req: FastifyRequest) => req.sessao ?? (() => { throw naoAutenticado() })()
const corpo = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>
const numero = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : undefined)

function idDaRota(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id)
  if (!Number.isInteger(id) || id <= 0) throw requisicaoInvalida('Id inválido')
  return id
}

export function createEstoqueController(service: EstoqueService) {
  return {
    async listar(req: FastifyRequest) {
      const s = sessaoOuErro(req)
      const q = req.query as Record<string, unknown>
      const r = await service.listar(s, {
        busca: typeof q.busca === 'string' ? q.busca : undefined, estado: typeof q.estado === 'string' ? q.estado : undefined,
        pagina: numero(q.pagina), limite: numero(q.limite),
      })
      return listaView(r, s.perfil)
    },
    async resumo(req: FastifyRequest) { const s = sessaoOuErro(req); return resumoView(await service.resumo(s), s.perfil) },
    async obter(req: FastifyRequest) { const s = sessaoOuErro(req); return aparelhoView(await service.obter(s, idDaRota(req)), s.perfil) },
    async criar(req: FastifyRequest, reply: FastifyReply) { const s = sessaoOuErro(req); return reply.code(201).send(aparelhoView(await service.criar(s, corpo(req)), s.perfil)) },
    async atualizar(req: FastifyRequest) { const s = sessaoOuErro(req); return aparelhoView(await service.atualizar(s, idDaRota(req), corpo(req)), s.perfil) },
  }
}
