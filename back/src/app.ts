import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Env } from './config/env.js'
import type { Db } from './db/connection.js'
import { exigirAuth } from './shared/auth-hooks.js'
import { HttpError } from './shared/errors.js'
import { authRoutes } from './modules/auth/routes.js'
import type { AuthService } from './modules/auth/services/auth.service.js'
import type { TokensService } from './modules/auth/services/tokens.js'
import { clientesRoutes } from './modules/clientes/routes.js'
import type { ClientesService } from './modules/clientes/services/clientes.service.js'
import { usuariosRoutes } from './modules/usuarios/routes.js'
import type { UsuariosService } from './modules/usuarios/services/usuarios.service.js'
import { indicadoresRoutes } from './modules/indicadores/routes.js'
import type { IndicadoresService } from './modules/indicadores/services/indicadores.service.js'
import { estoqueRoutes } from './modules/estoque/routes.js'
import type { EstoqueService } from './modules/estoque/services/estoque.service.js'
import { configRoutes } from './modules/config/routes.js'
import type { ConfigService } from './modules/config/services/config.service.js'
import { vendasRoutes } from './modules/vendas/routes.js'
import type { VendasService } from './modules/vendas/services/vendas.service.js'
import { recebimentosRoutes } from './modules/recebimentos/routes.js'
import type { RecebimentosService } from './modules/recebimentos/services/recebimentos.service.js'
import { healthRoutes } from './modules/health/routes.js'

/** Tudo o que o app precisa vem de fora (injeção), assim os testes trocam o banco por um falso. */
export type Deps = {
  env: Pick<Env, 'NODE_ENV' | 'CORS_ORIGIN'>
  db: Pick<Db, 'ping'>
  tokens: TokensService
  auth: AuthService
  clientes: ClientesService
  usuarios: UsuariosService
  indicadores: IndicadoresService
  estoque: EstoqueService
  vendas: VendasService
  config: ConfigService
  recebimentos: RecebimentosService
  /** Ajustes de limite; os testes sobem o limite para não esbarrar nele. */
  limites?: { vendasPorMinuto?: number; recebimentosPorMinuto?: number }
}

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.env.NODE_ENV === 'test' ? false : { redact: ['req.headers.authorization'] } })

  // Alguns clientes mandam POST sem corpo mas com "Content-Type: application/json" (logout, desfazer). O Fastify
  // recusaria com 400; aqui o corpo vazio vira {} e JSON quebrado continua sendo 400.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, corpo, feito) => {
    const texto = (corpo as string).trim()
    if (!texto) return feito(null, {})
    try { feito(null, JSON.parse(texto)) } catch { feito(Object.assign(new Error('JSON inválido'), { statusCode: 400 }), undefined) }
  })

  await app.register(helmet)
  await app.register(cors, { origin: deps.env.CORS_ORIGIN, credentials: false, methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'] })
  await app.register(rateLimit, { global: false })

  app.setErrorHandler((error, req, reply) => {
    const err = error as Error
    if (err instanceof HttpError) return reply.code(err.status).send({ erro: err.message, codigo: err.code })
    // erros de validação/limite do próprio Fastify mantêm o status deles
    const status = (err as { statusCode?: number }).statusCode
    if (status && status >= 400 && status < 500) return reply.code(status).send({ erro: err.message })
    req.log.error({ err }, 'erro não tratado')
    return reply.code(500).send({ erro: 'Erro interno' })
  })

  const exigir = exigirAuth(deps.tokens, deps.auth)
  await app.register(healthRoutes(deps.db))
  await app.register(authRoutes(deps.auth, exigir), { prefix: '/api' })
  await app.register(clientesRoutes(deps.clientes, exigir), { prefix: '/api' })
  await app.register(usuariosRoutes(deps.usuarios, exigir), { prefix: '/api' })
  await app.register(indicadoresRoutes(deps.indicadores, exigir), { prefix: '/api' })
  await app.register(estoqueRoutes(deps.estoque, exigir), { prefix: '/api' })
  await app.register(vendasRoutes(deps.vendas, exigir, deps.limites?.vendasPorMinuto), { prefix: '/api' })
  await app.register(configRoutes(deps.config, exigir), { prefix: '/api' })
  await app.register(recebimentosRoutes(deps.recebimentos, exigir, deps.limites?.recebimentosPorMinuto), { prefix: '/api' })

  return app
}
