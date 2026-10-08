import type { FastifyReply, FastifyRequest } from 'fastify'
import { naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { ClientesService } from '../services/clientes.service.js'
import { clienteView, listaView, salvoView } from '../views/clientes.view.js'

const sessaoOuErro = (req: FastifyRequest) => req.sessao ?? (() => { throw naoAutenticado() })()

function idDaRota(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id)
  if (!Number.isInteger(id) || id <= 0) throw requisicaoInvalida('Id inválido')
  return id
}

const numero = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : undefined)

export function createClientesController(service: ClientesService) {
  return {
    async listar(req: FastifyRequest) {
      const s = sessaoOuErro(req)
      const q = req.query as Record<string, unknown>
      const r = await service.listar(s, { busca: typeof q.busca === 'string' ? q.busca : undefined, pagina: numero(q.pagina), limite: numero(q.limite) })
      return listaView(r, s.perfil)
    },
    async obter(req: FastifyRequest) {
      const s = sessaoOuErro(req)
      return clienteView(await service.obter(s, idDaRota(req)), s.perfil)
    },
    async criar(req: FastifyRequest, reply: FastifyReply) {
      const s = sessaoOuErro(req)
      const r = await service.criar(s, (req.body ?? {}) as Record<string, unknown>)
      return reply.code(201).send(salvoView(r, s.perfil))
    },
    async atualizar(req: FastifyRequest) {
      const s = sessaoOuErro(req)
      return salvoView(await service.atualizar(s, idDaRota(req), (req.body ?? {}) as Record<string, unknown>), s.perfil)
    },
  }
}
