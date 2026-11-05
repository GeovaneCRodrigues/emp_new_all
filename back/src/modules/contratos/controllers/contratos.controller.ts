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
    async link(req: FastifyRequest, reply: FastifyReply) { return reply.code(201).send(await s.gerarLink(sessaoOuErro(req), id(req))) },
    // as duas abaixo são públicas (o cliente não tem login): quem manda é o token do link
    async verParaAssinar(req: FastifyRequest) { return s.verParaAssinar((req.params as { token: string }).token) },
    async assinarPeloLink(req: FastifyRequest) {
      return s.assinarPeloLink((req.params as { token: string }).token, corpo(req), { ip: req.ip ?? null, userAgent: (req.headers['user-agent'] as string | undefined) ?? null })
    },
    async zapsignStatus(req: FastifyRequest) { return s.zapsignStatus(sessaoOuErro(req)) },
    async enviarZapsign(req: FastifyRequest) { return s.enviarZapsign(sessaoOuErro(req), id(req)) },
    async atualizarZapsign(req: FastifyRequest) { return s.atualizarZapsign(sessaoOuErro(req), id(req)) },
    // pública: o ZapSign avisa que mexeu num documento (o segredo vem no cabeçalho ou na URL)
    async webhookZapsign(req: FastifyRequest) {
      const h = req.headers['x-webhook-secret'] ?? req.headers.authorization?.replace(/^Bearer\s+/i, '')
      const q = (req.query as Record<string, unknown>).secret
      return s.webhookZapsign(corpo(req), typeof h === 'string' ? h : typeof q === 'string' ? q : null)
    },
    async modelo(req: FastifyRequest) { return s.modelo(sessaoOuErro(req)) },
    async salvarModelo(req: FastifyRequest) { return s.salvarModelo(sessaoOuErro(req), corpo(req).texto) },
    async previa(req: FastifyRequest) { return s.previa(sessaoOuErro(req), corpo(req)) },
    async empresa(req: FastifyRequest) { return s.empresa(sessaoOuErro(req)) },
    async salvarLogo(req: FastifyRequest) { return s.salvarLogo(sessaoOuErro(req), corpo(req).imagem) },
    async removerLogo(req: FastifyRequest) { return s.removerLogo(sessaoOuErro(req)) },
    async logoPublica(_req: FastifyRequest, reply: FastifyReply) {
      const l = await s.logoPublica()
      if (!l) return reply.code(404).send({ erro: 'Sem logo' })
      return reply.header('content-type', l.tipo).header('cache-control', 'public, max-age=300').header('x-content-type-options', 'nosniff').send(l.bytes)
    },
    async salvarEmpresa(req: FastifyRequest) { return s.salvarEmpresa(sessaoOuErro(req), corpo(req)) },
  }
}
