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
import { createAcordosRepository } from './modules/acordos/models/repository.js'
import { createPropostasRepository } from './modules/propostas/models/repository.js'
import { createPropostasService } from './modules/propostas/services/propostas.service.js'
import { createRepassesRepository } from './modules/repasses/models/repository.js'
import { createRepassesService } from './modules/repasses/services/repasses.service.js'
import { createAcordosService } from './modules/acordos/services/acordos.service.js'
import { createEmprestimosRepository } from './modules/emprestimos/models/repository.js'
import { createEmprestimosService } from './modules/emprestimos/services/emprestimos.service.js'
import { createVendasRepository } from './modules/vendas/models/repository.js'
import { createVendasService } from './modules/vendas/services/vendas.service.js'
import { createRecebimentosRepository } from './modules/recebimentos/models/repository.js'
import { createRecebimentosService } from './modules/recebimentos/services/recebimentos.service.js'
import { createAprovacoesRepository } from './modules/aprovacoes/models/repository.js'
import { createAprovacoesService } from './modules/aprovacoes/services/aprovacoes.service.js'
import { createFechamentosRepository } from './modules/fechamentos/models/repository.js'
import { createCaixaRepository } from './modules/caixa/models/repository.js'
import { createCaixaService } from './modules/caixa/services/caixa.service.js'
import { createContratosRepository } from './modules/contratos/models/repository.js'
import { createContratosService } from './modules/contratos/services/contratos.service.js'
import { createRelatoriosRepository } from './modules/relatorios/models/repository.js'
import { createRelatoriosService } from './modules/relatorios/services/relatorios.service.js'
import { createFechamentosService } from './modules/fechamentos/services/fechamentos.service.js'
import { createEquipeRepository } from './modules/equipe/models/repository.js'
import { createEquipeService } from './modules/equipe/services/equipe.service.js'
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
const contratos = createContratosService({ repo: createContratosRepository(db.knex), auditoria: createAuditoriaRepository(db.knex), log: (msg, err) => console.error(msg, err) })
const vendas = createVendasService({
  vendas: createVendasRepository(db.knex), config: configRepo, auditoria: createAuditoriaRepository(db.knex), gerarContrato: (id, u) => contratos.gerarDaVenda(id, u),
  sincronizarNiveis: () => indicadores.sincronizarNiveis(), log: (msg, err) => console.error(msg, err),
})

const emprestimos = createEmprestimosService({
  emprestimos: createEmprestimosRepository(db.knex), auditoria: createAuditoriaRepository(db.knex),
  sincronizarNiveis: () => indicadores.sincronizarNiveis(), log: (msg, err) => console.error(msg, err),
})

const acordos = createAcordosService({ repo: createAcordosRepository(db.knex), auditoria: createAuditoriaRepository(db.knex) })

const repasses = createRepassesService({
  repo: createRepassesRepository(db.knex), indicadores: createIndicadoresRepository(db.knex), vendas: createVendasRepository(db.knex),
  emprestimos: createEmprestimosRepository(db.knex), auditoria: createAuditoriaRepository(db.knex),
})

const propostas = createPropostasService({ repo: createPropostasRepository(db.knex), auditoria: createAuditoriaRepository(db.knex) })

const recebimentos = createRecebimentosService({ repo: createRecebimentosRepository(db.knex), auditoria: createAuditoriaRepository(db.knex) })

const aud = createAuditoriaRepository(db.knex)
const aprovacoes = createAprovacoesService({ repo: createAprovacoesRepository(db.knex), auditoria: aud, baixas: { confirmar: (s, id, e) => recebimentos.confirmarBaixa(s, id, e) } })
const fechamentos = createFechamentosService({ repo: createFechamentosRepository(db.knex), auditoria: aud })
const caixa = createCaixaService({ repo: createCaixaRepository(db.knex), auditoria: aud })
const equipe = createEquipeService({ repo: createEquipeRepository(db.knex), auditoria: aud })

const relatorios = createRelatoriosService({
  repo: createRelatoriosRepository(db.knex), vendas: createVendasRepository(db.knex), emprestimos: createEmprestimosRepository(db.knex), caixa: createCaixaRepository(db.knex),
  indicadores: createIndicadoresRepository(db.knex), repasses,
})
const app = await buildApp({ env, db, tokens, auth, clientes, usuarios, indicadores, estoque, vendas, emprestimos, acordos, repasses, propostas, caixa, relatorios, contratos, config: createConfigService(configRepo), recebimentos, aprovacoes, fechamentos, equipe })

const encerrar = async () => { await app.close(); await db.close(); process.exit(0) }
process.on('SIGINT', encerrar)
process.on('SIGTERM', encerrar)

await app.listen({ port: env.PORT, host: '0.0.0.0' })
