import type { FastifyReply, FastifyRequest } from 'fastify'
import { naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { ContratosService } from '../services/contratos.service.js'

const sessaoOuErro = (req: FastifyRequest) => req.sessao ?? (() => { throw naoAutenticado() })()
const corpo = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>
function id(req: FastifyRequest, campo = 'id'): number {
  const n = Number((req.params as Record<string, string>)[campo])
  if (!Number.isInteger(n) || n <= 0) throw requisicaoInvalida('Id inválido')
  return n
}

export function createContratosController(s: ContratosService) {
  return {
    async listar(req: FastifyRequest) { return s.listar(sessaoOuErro(req), { status: (req.query as Record<string, string | undefined>).status }) },
    async obter(req: FastifyRequest) { return s.obter(sessaoOuErro(req), id(req)) },
    async porVenda(req: FastifyRequest) { return s.porVenda(sessaoOuErro(req), id(req, 'vendaId')) },
    async gerar(req: FastifyRequest, reply: FastifyReply) { return reply.code(201).send(await s.gerar(sessaoOuErro(req), id(req, 'vendaId'))) },
    async enviado(req: FastifyRequest) { return s.marcarEnviado(sessaoOuErro(req), id(req)) },
    async assinado(req: FastifyRequest) { return s.marcarAssinado(sessaoOuErro(req), id(req)) },
    async seguro(req: FastifyRequest) { return s.definirSeguro(sessaoOuErro(req), id(req), corpo(req).seguro) },
    async modelo(req: FastifyRequest) { return s.modelo(sessaoOuErro(req)) },
    async salvarModelo(req: FastifyRequest) { return s.salvarModelo(sessaoOuErro(req), corpo(req).texto) },
    async previa(req: FastifyRequest) { return s.previa(sessaoOuErro(req), corpo(req)) },
    async empresa(req: FastifyRequest) { return s.empresa(sessaoOuErro(req)) },
    async salvarEmpresa(req: FastifyRequest) { return s.salvarEmpresa(sessaoOuErro(req), corpo(req)) },
  }
}
