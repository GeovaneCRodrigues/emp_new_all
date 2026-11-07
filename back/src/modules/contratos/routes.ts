import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createContratosController } from './controllers/contratos.controller.js'
import type { ContratosService } from './services/contratos.service.js'

export function contratosRoutes(service: ContratosService, auth: preHandlerAsyncHookHandler, assinaturasPorMinuto = 10) {
  const c = createContratosController(service)
  const p = { preHandler: auth }
  return async (app: FastifyInstance) => {
    // modelo e empresa são do administrador; vendedor lê e manda os contratos das vendas dele (as regras estão no serviço)
    app.get('/contratos/modelo', p, c.modelo)
    app.put('/contratos/modelo', p, c.salvarModelo)
    app.post('/contratos/modelo/previa', p, c.previa)
    app.get('/contratos/empresa', p, c.empresa)
    app.put('/contratos/empresa', p, c.salvarEmpresa)
    app.put('/contratos/empresa/logo', { ...p, bodyLimit: 600_000 }, c.salvarLogo)
    app.delete('/contratos/empresa/logo', p, c.removerLogo)
    // a logo é identidade visual, não segredo: sai sem login para o <img> e para a página de assinatura do cliente
    app.get('/empresa/logo', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, c.logoPublica)
    app.get('/contratos/venda/:vendaId', p, c.porVenda)
    app.post('/contratos/venda/:vendaId', p, c.gerar)
    app.get('/contratos', p, c.listar)
    app.get('/contratos/:id', p, c.obter)
    app.post('/contratos/:id/enviado', p, c.enviado)
    app.post('/contratos/:id/assinado', p, c.assinado)
    app.get('/contratos/:id/assinado.pdf', { ...p, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, c.arquivoAssinado)
    app.post('/contratos/:id/link', { ...p, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, c.link)
    app.get('/contratos/zapsign/status', p, c.zapsignStatus)
    app.post('/contratos/:id/zapsign', { ...p, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, c.enviarZapsign)
    app.post('/contratos/:id/zapsign/atualizar', { ...p, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, c.atualizarZapsign)
    app.post('/zapsign/webhook', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, c.webhookZapsign)
    // páginas públicas de assinatura: sem login, limitadas por IP (o token é aleatório de 256 bits e só o hash fica guardado)
    app.get('/assinar/:token', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, c.verParaAssinar)
    app.post('/assinar/:token', { config: { rateLimit: { max: assinaturasPorMinuto, timeWindow: '1 minute' } }, bodyLimit: 600_000 }, c.assinarPeloLink)
  }
}
