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
import { healthRoutes } from './modules/health/routes.js'

/** Tudo o que o app precisa vem de fora (injeção), assim os testes trocam o banco por um falso. */
export type Deps = {
  env: Pick<Env, 'NODE_ENV' | 'CORS_ORIGIN'>
  db: Pick<Db, 'ping'>
  tokens: TokensService
  auth: AuthService
  clientes: ClientesService
  usuarios: UsuariosService
}

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.env.NODE_ENV === 'test' ? false : { redact: ['req.headers.authorization'] } })

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

  return app
}
