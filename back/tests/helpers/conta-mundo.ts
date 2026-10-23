import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import type { Knex } from 'knex'
import { buildApp } from '../../src/app.js'
import { createAcordosRepository } from '../../src/modules/acordos/models/repository.js'
import { createAcordosService } from '../../src/modules/acordos/services/acordos.service.js'
import { createAprovacoesRepository } from '../../src/modules/aprovacoes/models/repository.js'
import { createAprovacoesService } from '../../src/modules/aprovacoes/services/aprovacoes.service.js'
import { createAuditoriaRepository } from '../../src/modules/auditoria/models/repository.js'
import { createSessoesRepository, createUsuariosRepository } from '../../src/modules/auth/models/repository.js'
import { createAuthService } from '../../src/modules/auth/services/auth.service.js'
import { hashSenha } from '../../src/modules/auth/services/password.js'
import { createTokensService } from '../../src/modules/auth/services/tokens.js'
import { createCaixaRepository } from '../../src/modules/caixa/models/repository.js'
import { createCaixaService } from '../../src/modules/caixa/services/caixa.service.js'
import { createContaIndicadorRepository } from '../../src/modules/conta-indicador/models/repository.js'
import { createContaIndicadorService } from '../../src/modules/conta-indicador/services/conta-indicador.service.js'
import { createConfigRepository } from '../../src/modules/config/models/repository.js'
import { createConfigService } from '../../src/modules/config/services/config.service.js'
import { createEmprestimosRepository } from '../../src/modules/emprestimos/models/repository.js'
import { createEmprestimosService } from '../../src/modules/emprestimos/services/emprestimos.service.js'
import { createEstoqueRepository } from '../../src/modules/estoque/models/repository.js'
import { createEstoqueService } from '../../src/modules/estoque/services/estoque.service.js'
import { createIndicadoresRepository } from '../../src/modules/indicadores/models/repository.js'
import { createIndicadoresService } from '../../src/modules/indicadores/services/indicadores.service.js'
import { createRecebimentosRepository } from '../../src/modules/recebimentos/models/repository.js'
import { createRecebimentosService } from '../../src/modules/recebimentos/services/recebimentos.service.js'
import { createVendasRepository } from '../../src/modules/vendas/models/repository.js'
import { createVendasService } from '../../src/modules/vendas/services/vendas.service.js'
import { limparBanco } from './db.js'

export const SENHA = 'senha-forte-123'

export type Mundo = {
  app: FastifyInstance
  t: Record<string, string>
  id: Record<string, number>
  req: (metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, papel?: string, payload?: object) => Promise<LightMyRequestResponse>
  setHoje: (d: string) => void
  /** apaga o que cada teste cria (operações, recebimentos, caixa); usuários, indicadores e o cliente ficam */
  limpar: () => Promise<void>
  /** empréstimo parcelado do cliente Ana com o indicador Roberto (capital 1.000, taxa 30, 2 parcelas); `corpo` sobrescreve campos */
  emprestimo: (corpo?: object) => Promise<number>
}

export async function montarMundo(k: Knex, hojeInicial = '2026-10-08'): Promise<Mundo> {
  let hoje = hojeInicial
  await limparBanco(k)
  const hash = await hashSenha(SENHA)
  const id: Record<string, number> = {}
  for (const [chave, nome] of [['roberto', 'Roberto'], ['carla', 'Carla']] as const) {
    const [i] = await k('indicadores').insert({ nome, pct: 0.5, pct_manual: true }).returning('id'); id[chave] = i.id
  }
  for (const [chave, perfil, extra] of [['admin', 'ADMIN', {}], ['cobrador', 'COBRADOR', {}], ['indicador', 'INDICADOR', { indicador_id: id.roberto }], ['indicador2', 'INDICADOR', { indicador_id: id.carla }]] as const) {
    const [u] = await k('users').insert({ nome: `${chave} Silva`, email: `${chave}@t.com`, senha_hash: hash, perfil, ...extra }).returning('id'); id[chave] = u.id
  }
  const [c] = await k('clientes').insert({ nome: 'Ana Souza', fone: '11988124410' }).returning('id'); id.ana = c.id

  const tokens = createTokensService('x'.repeat(40), '15m')
  const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
  const audit = createAuditoriaRepository(k)
  const indicadores = createIndicadoresService(createIndicadoresRepository(k), audit)
  const config = createConfigRepository(k)
  const recebimentos = createRecebimentosService({ repo: createRecebimentosRepository(k), auditoria: audit, hoje: () => hoje })
  const app = await buildApp({
    env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, usuarios: {} as never, indicadores,
    clientes: {} as never,
    estoque: createEstoqueService(createEstoqueRepository(k), audit), config: createConfigService(config),
    vendas: createVendasService({ vendas: createVendasRepository(k), config, auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis(), hoje: () => hoje }),
    emprestimos: createEmprestimosService({ emprestimos: createEmprestimosRepository(k), auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis(), hoje: () => hoje }),
    recebimentos,
    acordos: createAcordosService({ repo: createAcordosRepository(k), auditoria: audit, hoje: () => hoje }),
    caixa: createCaixaService({ repo: createCaixaRepository(k), auditoria: audit, hoje: () => hoje }),
    contaIndicador: createContaIndicadorService({ repo: createContaIndicadorRepository(k), auditoria: audit, hoje: () => hoje }),
    aprovacoes: createAprovacoesService({ repo: createAprovacoesRepository(k), auditoria: audit, hoje: () => hoje, baixas: { confirmar: (s, pid, e) => recebimentos.confirmarBaixa(s, pid, e) } }),
    fechamentos: {} as never, equipe: {} as never,
    limites: { vendasPorMinuto: 100_000, recebimentosPorMinuto: 100_000 },
  })
  const t: Record<string, string> = {}
  for (const papel of ['admin', 'cobrador', 'indicador', 'indicador2']) {
    t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  }
  const req: Mundo['req'] = (metodo, url, papel, payload) => app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  return {
    app, t, id, req,
    setHoje: (d) => { hoje = d },
    limpar: async () => {
      hoje = hojeInicial
      for (const tb of ['aprovacoes', 'recebimentos', 'transacoes_recebimento', 'movimentacoes_caixa', 'auditoria', 'acordos', 'emprestimo_parcelas', 'emprestimos']) await k(tb).del()
    },
    emprestimo: async (corpo = {}) => {
      const r = await req('POST', '/api/emprestimos', 'admin', { clienteId: id.ana, modalidade: 'PARCELADO', capital: 1000, taxa: 30, parcelas: 2, indicadorId: id.roberto, ...corpo })
      if (r.statusCode !== 201) throw new Error(`empréstimo não criado: ${r.statusCode} ${r.body}`)
      return r.json().id
    },
  }
}
