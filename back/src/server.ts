import 'dotenv/config'
import { buildApp } from './app.js'
import { parseEnv } from './config/env.js'
import { createDb } from './db/connection.js'
import { createSessoesRepository, createUsuariosRepository } from './modules/auth/models/repository.js'
import { createAuthService } from './modules/auth/services/auth.service.js'
import { createTokensService } from './modules/auth/services/tokens.js'

const env = parseEnv()
const db = createDb(env)
const tokens = createTokensService(env.JWT_SECRET, env.JWT_EXPIRES_IN)
const auth = createAuthService(createUsuariosRepository(db.knex), createSessoesRepository(db.knex), tokens, { refreshTtlMs: env.REFRESH_TTL_DIAS * 24 * 3600_000 })

const app = await buildApp({ env, db, tokens, auth })

const encerrar = async () => { await app.close(); await db.close(); process.exit(0) }
process.on('SIGINT', encerrar)
process.on('SIGTERM', encerrar)

await app.listen({ port: env.PORT, host: '0.0.0.0' })
