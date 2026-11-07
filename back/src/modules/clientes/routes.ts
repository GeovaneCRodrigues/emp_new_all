import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { createClientesController } from './controllers/clientes.controller.js'
import type { ClientesService } from './services/clientes.service.js'
import { createDocumentosController } from './controllers/documentos.controller.js'
import { MAX_ARQUIVO, type DocumentosService } from './services/documentos.service.js'

export function clientesRoutes(service: ClientesService, auth: preHandlerAsyncHookHandler, documentos?: DocumentosService) {
  const c = createClientesController(service)
  return async (app: FastifyInstance) => {
    // quem pode o quê fica no service (precisa do escopo); aqui só exige estar logado
    app.get('/clientes', { preHandler: auth }, c.listar)
    app.get('/clientes/:id', { preHandler: auth }, c.obter)
    app.post('/clientes', { preHandler: auth }, c.criar)
    app.patch('/clientes/:id', { preHandler: auth }, c.atualizar)
    if (documentos) {
      const d = createDocumentosController(documentos)
      const limite = { rateLimit: { max: 60, timeWindow: '1 minute' } }
      app.get('/clientes/:id/documentos', { preHandler: auth }, d.listar)
      // o arquivo vai em base64 dentro do JSON (cresce ~1/3): o limite do corpo acompanha o do arquivo
      app.post('/clientes/:id/documentos', { preHandler: auth, config: limite, bodyLimit: Math.ceil(MAX_ARQUIVO * 4 / 3) + 4096 }, d.enviar)
      app.get('/clientes/:id/documentos/:docId/arquivo', { preHandler: auth, config: limite }, d.arquivo)
      app.delete('/clientes/:id/documentos/:docId', { preHandler: auth, config: limite }, d.remover)
    }
  }
}
