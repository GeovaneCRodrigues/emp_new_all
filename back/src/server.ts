import 'dotenv/config'
import { buildApp } from './app.js'
import { parseEnv } from './config/env.js'
import { createDb } from './db/connection.js'
import { createAuditoriaRepository } from './modules/auditoria/models/repository.js'
import { createClientesRepository } from './modules/clientes/models/repository.js'
import { createUsuariosListaRepository } from './modules/usuarios/models/repository.js'
import { createUsuariosService } from './modules/usuarios/services/usuarios.service.js'
import { createIndicadoresRepository } from './modules/indicadores/models/repository.js'
import { createIndicadoresService } from './modules/indicadores/services/indicadores.service.js'
import { createEstoqueRepository } from './modules/estoque/models/repository.js'
import { createEstoqueService } from './modules/estoque/services/estoque.service.js'
import { createConfigRepository } from './modules/config/models/repository.js'
import { createConfigService } from './modules/config/services/config.service.js'
import { createVendasRepository } from './modules/vendas/models/repository.js'
import { createVendasService } from './modules/vendas/services/vendas.service.js'
import { createRecebimentosRepository } from './modules/recebimentos/models/repository.js'
import { createRecebimentosService } from './modules/recebimentos/services/recebimentos.service.js'
import { createClientesService } from './modules/clientes/services/clientes.service.js'
import { createSessoesRepository, createUsuariosRepository } from './modules/auth/models/repository.js'
import { createAuthService } from './modules/auth/services/auth.service.js'
import { createTokensService } from './modules/auth/services/tokens.js'

const env = parseEnv()
const db = createDb(env)
const tokens = createTokensService(env.JWT_SECRET, env.JWT_EXPIRES_IN)
const auth = createAuthService(createUsuariosRepository(db.knex), createSessoesRepository(db.knex), tokens, { refreshTtlMs: env.REFRESH_TTL_DIAS * 24 * 3600_000 })

const clientes = createClientesService(createClientesRepository(db.knex), createAuditoriaRepository(db.knex))

const usuarios = createUsuariosService(createUsuariosListaRepository(db.knex))

const indicadores = createIndicadoresService(createIndicadoresRepository(db.knex), createAuditoriaRepository(db.knex))

const estoque = createEstoqueService(createEstoqueRepository(db.knex), createAuditoriaRepository(db.knex))

const configRepo = createConfigRepository(db.knex)
const vendas = createVendasService({
  vendas: createVendasRepository(db.knex), config: configRepo, auditoria: createAuditoriaRepository(db.knex),
  sincronizarNiveis: () => indicadores.sincronizarNiveis(), log: (msg, err) => console.error(msg, err),
})

const recebimentos = createRecebimentosService({ repo: createRecebimentosRepository(db.knex), auditoria: createAuditoriaRepository(db.knex) })

const app = await buildApp({ env, db, tokens, auth, clientes, usuarios, indicadores, estoque, vendas, config: createConfigService(configRepo), recebimentos })

const encerrar = async () => { await app.close(); await db.close(); process.exit(0) }
process.on('SIGINT', encerrar)
process.on('SIGTERM', encerrar)

await app.listen({ port: env.PORT, host: '0.0.0.0' })
