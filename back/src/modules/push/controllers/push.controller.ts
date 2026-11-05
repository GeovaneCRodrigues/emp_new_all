import type { FastifyReply, FastifyRequest } from 'fastify'
import { HttpError, naoAutenticado } from '../../../shared/errors.js'
import type { PushService } from '../services/push.service.js'

const sessaoOuErro = (req: FastifyRequest) => req.sessao ?? (() => { throw naoAutenticado() })()

export function createPushController(service: PushService) {
  return {
    async config() { return { ligado: service.ligado(), chavePublica: service.chavePublica() } },
    async inscrever(req: FastifyRequest, reply: FastifyReply) {
      const s = sessaoOuErro(req)
      if (!service.ligado()) throw new HttpError(503, 'Avisos no celular não estão ativados neste servidor', 'PUSH_DESLIGADO')
      await service.inscrever(s.usuarioId, (req.body ?? {}) as Record<string, unknown>, req.headers['user-agent'] ?? null)
      return reply.code(204).send()
    },
    async cancelar(req: FastifyRequest, reply: FastifyReply) {
      await service.cancelar(sessaoOuErro(req).usuarioId, (req.body as { endpoint?: unknown } | undefined)?.endpoint)
      return reply.code(204).send()
    },
    /** Manda um aviso de teste aos aparelhos de quem está logado. */
    async testar(req: FastifyRequest) {
      const s = sessaoOuErro(req)
      if (!service.ligado()) throw new HttpError(503, 'Avisos no celular não estão ativados neste servidor', 'PUSH_DESLIGADO')
      const r = await service.enviar(s.usuarioId, { titulo: 'Avisos ativados', texto: 'Teste: você vai receber os avisos do Mundo dos iPhones por aqui.', rota: '/', tag: 'teste' })
      if (!r.enviados) throw new HttpError(409, 'Nenhum aparelho recebeu. Ative os avisos neste aparelho.', 'PUSH_SEM_APARELHO')
      return r
    },
  }
}
