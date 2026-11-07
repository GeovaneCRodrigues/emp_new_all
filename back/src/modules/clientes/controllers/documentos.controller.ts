import type { FastifyReply, FastifyRequest } from 'fastify'
import { naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { DocumentosService } from '../services/documentos.service.js'

const sessaoOuErro = (req: FastifyRequest) => req.sessao ?? (() => { throw naoAutenticado() })()
function inteiro(req: FastifyRequest, campo: string): number {
  const n = Number((req.params as Record<string, string | undefined>)[campo])
  if (!Number.isInteger(n) || n <= 0) throw requisicaoInvalida('Id inválido')
  return n
}

export function createDocumentosController(s: DocumentosService) {
  return {
    async listar(req: FastifyRequest) {
      return { itens: await s.listar(sessaoOuErro(req), inteiro(req, 'id')) }
    },
    async enviar(req: FastifyRequest, reply: FastifyReply) {
      return reply.code(201).send(await s.enviar(sessaoOuErro(req), inteiro(req, 'id'), (req.body ?? {}) as Record<string, unknown>))
    },
    async arquivo(req: FastifyRequest, reply: FastifyReply) {
      const { doc, conteudo } = await s.arquivo(sessaoOuErro(req), inteiro(req, 'id'), inteiro(req, 'docId'))
      return reply.header('content-type', doc.mime).header('content-disposition', `inline; filename="${doc.nome}"`)
        .header('cache-control', 'no-store').header('x-content-type-options', 'nosniff').header('content-security-policy', "default-src 'none'; sandbox").send(conteudo)
    },
    async remover(req: FastifyRequest, reply: FastifyReply) {
      await s.remover(sessaoOuErro(req), inteiro(req, 'id'), inteiro(req, 'docId'))
      return reply.code(204).send()
    },
  }
}
