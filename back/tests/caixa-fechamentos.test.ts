import type { FastifyInstance } from 'fastify'
import type { Knex } from 'knex'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { createAuditoriaRepository } from '../src/modules/auditoria/models/repository.js'
import { createSessoesRepository, createUsuariosRepository } from '../src/modules/auth/models/repository.js'
import { createAuthService } from '../src/modules/auth/services/auth.service.js'
import { hashSenha } from '../src/modules/auth/services/password.js'
import { createTokensService } from '../src/modules/auth/services/tokens.js'
import { createCaixaRepository } from '../src/modules/caixa/models/repository.js'
import { createCaixaFechamentosRepository } from '../src/modules/caixa-fechamentos/models/repository.js'
import { createCaixaFechamentosService } from '../src/modules/caixa-fechamentos/services/caixa-fechamentos.service.js'
import { createConfigRepository } from '../src/modules/config/models/repository.js'
import { createConfigService } from '../src/modules/config/services/config.service.js'
import { createEstoqueRepository } from '../src/modules/estoque/models/repository.js'
import { createEstoqueService } from '../src/modules/estoque/services/estoque.service.js'
import { createIndicadoresRepository } from '../src/modules/indicadores/models/repository.js'
import { createIndicadoresService } from '../src/modules/indicadores/services/indicadores.service.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()
const SENHA = 'senha-forte-123'
const HOJE = '2026-10-15'
const ONTEM = '2026-10-14'

type Fech = { id: number; dia: string; obs: string | null; por: string; criadoEm: string }
type Lista = { hoje: string; ultimo: Fech | null; diasSemFechar: number | null; itens: Fech[] }
type Previa = { de: string; ate: string; entrou: number; saiu: number; saldo: number; porLado: Record<'EMPRESTIMO' | 'IPHONE' | 'SEM_LADO', { entrou: number; saiu: number }>; itens: { data: string; valor: number; entrada: boolean; titulo: string }[]; cortado: boolean }

describe.skipIf(!db)('fechamento do caixa da loja (Postgres de verdade)', () => {
  let app: FastifyInstance
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}
  const req = (metodo: 'GET' | 'POST' | 'DELETE', url: string, papel?: string, payload?: object) => app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  const lista = async () => (await req('GET', '/api/caixa/fechamentos', 'admin')).json() as Lista
  const previa = async (dia: string) => (await req('GET', `/api/caixa/fechamentos/previa?dia=${dia}`, 'admin')).json() as Previa
  const fechar = (dia: unknown, obs?: unknown) => req('POST', '/api/caixa/fechamentos', 'admin', { dia, ...(obs === undefined ? {} : { obs }) })
  const manual = (tipo: string, valor: number, data: string, lado: string | null = 'EMPRESTIMO', obs: string | null = null) => db!('movimentacoes_caixa').insert({ tipo, valor, data, obs, lado })
  async function recibo(valor: number, data: string) {
    const [tr] = await db!('transacoes_recebimento').insert({
      numero_recibo: Math.floor(Math.random() * 1e9), cliente_id: id.cli, valor_total: valor, forma_pagamento: 'PIX', data_recebimento: data, resumo: JSON.stringify({ referencia: 'parcela 1/4' }),
    }).returning('id')
    return tr.id as number
  }

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    const hash = await hashSenha(SENHA)
    id.ind = (await k('indicadores').insert({ nome: 'Roberto', pct: 0.5 }).returning('id'))[0].id
    for (const [c, perfil, extra] of [['admin', 'ADMIN', {}], ['vendedor', 'VENDEDOR', {}], ['cobrador', 'COBRADOR', {}], ['indicador', 'INDICADOR', { indicador_id: id.ind }]] as const) {
      id[c] = (await k('users').insert({ nome: `${c} Silva`, email: `${c}@t.com`, senha_hash: hash, perfil, ...extra }).returning('id'))[0].id
    }
    id.cli = (await k('clientes').insert({ nome: 'ANA SOUZA', fone: '11988124410' }).returning('id'))[0].id
    const tokens = createTokensService('x'.repeat(40), '15m')
    const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
    const audit = createAuditoriaRepository(k)
    const indicadores = createIndicadoresService(createIndicadoresRepository(k), audit)
    app = await buildApp({
      env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, clientes: {} as never, usuarios: {} as never, indicadores,
      estoque: createEstoqueService(createEstoqueRepository(k), audit), config: createConfigService(createConfigRepository(k)), vendas: {} as never, recebimentos: {} as never,
      aprovacoes: {} as never, fechamentos: {} as never, equipe: {} as never,
      caixaFechamentos: createCaixaFechamentosService({ repo: createCaixaFechamentosRepository(k), caixa: createCaixaRepository(k), auditoria: audit, hoje: () => HOJE }),
      limites: { vendasPorMinuto: 100_000, recebimentosPorMinuto: 100_000 },
    })
    for (const papel of ['admin', 'vendedor', 'cobrador', 'indicador']) t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  })
  beforeEach(async () => {
    const k = db!
    for (const tab of ['fechamentos_caixa_loja', 'recebimentos', 'transacoes_recebimento', 'repasses_indicador', 'movimentacoes_caixa', 'auditoria']) await k(tab).del()
  })
  afterAll(async () => { await app?.close(); await db?.destroy() })

  describe('quem pode', () => {
    it('só o administrador (sem login é 401, os outros perfis 403)', async () => {
      expect((await req('GET', '/api/caixa/fechamentos')).statusCode).toBe(401)
      for (const papel of ['vendedor', 'cobrador', 'indicador']) {
        expect((await req('GET', '/api/caixa/fechamentos', papel)).statusCode).toBe(403)
        expect((await req('GET', `/api/caixa/fechamentos/previa?dia=${ONTEM}`, papel)).statusCode).toBe(403)
        expect((await req('POST', '/api/caixa/fechamentos', papel, { dia: ONTEM })).statusCode).toBe(403)
        expect((await req('DELETE', '/api/caixa/fechamentos/1', papel)).statusCode).toBe(403)
      }
    })
  })

  describe('o último dia fechado', () => {
    it('nunca fechou: sem último e sem contagem de dias', async () => {
      expect(await lista()).toEqual({ hoje: HOJE, ultimo: null, diasSemFechar: null, itens: [] })
    })

    it('fecha ontem: vira o último, com quem fechou, e não há dias sem fechar', async () => {
      const r = await fechar(ONTEM, 'conferi o pix')
      expect(r.statusCode).toBe(201)
      expect(r.json()).toMatchObject({ dia: ONTEM, obs: 'conferi o pix', por: 'admin Silva' })
      const l = await lista()
      expect(l.ultimo).toMatchObject({ dia: ONTEM, obs: 'conferi o pix' })
      expect(l.diasSemFechar).toBe(0)
      expect(l.itens).toHaveLength(1)
    })

    it('conta os dias que passaram sem fechar (até ontem)', async () => {
      await fechar('2026-10-11')
      expect((await lista()).diasSemFechar).toBe(3) // 12, 13 e 14
    })

    it('pode fechar mais de uma vez, inclusive o mesmo dia de novo; o último é o mais recente', async () => {
      await fechar('2026-10-12')
      expect((await fechar('2026-10-13')).statusCode).toBe(201)
      expect((await fechar('2026-10-13', 'de novo')).statusCode).toBe(201)
      const l = await lista()
      expect(l.itens.map((i) => i.dia)).toEqual(['2026-10-13', '2026-10-13', '2026-10-12'])
      expect(l.ultimo?.obs).toBe('de novo')
    })

    it('não fecha dia anterior ao último já fechado', async () => {
      await fechar('2026-10-13')
      const r = await fechar('2026-10-12')
      expect(r.statusCode).toBe(409)
      expect(r.json().codigo).toBe('DIA_ANTERIOR_AO_FECHADO')
      expect((await lista()).itens).toHaveLength(1)
    })

    it('hoje pode (o dia ainda não acabou, mas o dono decide); amanhã não', async () => {
      expect((await fechar(HOJE)).statusCode).toBe(201)
      const r = await fechar('2026-10-16')
      expect(r.statusCode).toBe(400)
      expect(r.json().erro).toMatch(/futuro/)
    })

    it('recusa dia inválido, ausente e observação grande demais', async () => {
      for (const dia of [undefined, '', '15/10/2026', '2026-02-30', 20261014, null]) expect((await fechar(dia)).statusCode).toBe(400)
      expect((await fechar(ONTEM, 'x'.repeat(201))).statusCode).toBe(400)
      expect((await fechar(ONTEM, 123)).statusCode).toBe(400)
      expect((await lista()).itens).toHaveLength(0)
    })

    it('a observação vazia vira nula e fica na auditoria', async () => {
      const r = await fechar(ONTEM, '   ')
      expect(r.json().obs).toBeNull()
      const a = await db!('auditoria').where({ acao: 'CAIXA_FECHADO' })
      expect(a).toHaveLength(1)
      expect(a[0].usuario_id).toBe(id.admin)
    })
  })

  describe('desfazer', () => {
    it('desfaz só o último fechamento; o anterior passa a ser o último', async () => {
      const a = (await fechar('2026-10-12')).json() as Fech
      const b = (await fechar('2026-10-13')).json() as Fech
      expect((await req('DELETE', `/api/caixa/fechamentos/${a.id}`, 'admin')).statusCode).toBe(409)
      expect((await req('DELETE', `/api/caixa/fechamentos/${b.id}`, 'admin')).statusCode).toBe(204)
      expect((await lista()).ultimo?.dia).toBe('2026-10-12')
      expect(await db!('auditoria').where({ acao: 'CAIXA_FECHAMENTO_DESFEITO' })).toHaveLength(1)
    })

    it('fechamento que não existe é 404 e id ruim é 400', async () => {
      expect((await req('DELETE', '/api/caixa/fechamentos/9999', 'admin')).statusCode).toBe(404)
      expect((await req('DELETE', '/api/caixa/fechamentos/abc', 'admin')).statusCode).toBe(400)
    })
  })

  describe('o resumo para conciliar antes de fechar', () => {
    it('sem fechamento anterior: só o dia escolhido, com o que entrou e saiu por lado', async () => {
      await manual('APORTE', 1000, '2026-10-01') // marco zero (não entra no dia)
      await recibo(300, ONTEM)
      await recibo(200, ONTEM)
      await recibo(999, '2026-10-13') // outro dia
      await manual('DESPESA', 50, ONTEM, 'IPHONE', 'frete')
      const p = await previa(ONTEM)
      expect(p).toMatchObject({ de: ONTEM, ate: ONTEM, entrou: 500, saiu: 50, saldo: 450, cortado: false })
      expect(p.porLado.IPHONE).toEqual({ entrou: 200 + 300, saiu: 50 }) // recibo sem parcela de empréstimo conta como iPhone
      expect(p.itens.map((i) => i.valor).sort((x, y) => x - y)).toEqual([50, 200, 300])
    })

    it('com fechamento anterior: do dia seguinte a ele até o dia escolhido', async () => {
      await manual('APORTE', 1000, '2026-10-01')
      await recibo(100, '2026-10-11') // já fechado
      await fechar('2026-10-11')
      await recibo(10, '2026-10-12')
      await recibo(20, '2026-10-13')
      await recibo(40, '2026-10-15') // depois do dia escolhido
      const p = await previa('2026-10-13')
      expect(p).toMatchObject({ de: '2026-10-12', ate: '2026-10-13', entrou: 30, saiu: 0, saldo: 30 })
    })

    it('fechar o mesmo dia de novo mostra só aquele dia', async () => {
      await manual('APORTE', 1000, '2026-10-01')
      await recibo(100, '2026-10-13')
      await fechar('2026-10-13')
      expect(await previa('2026-10-13')).toMatchObject({ de: '2026-10-13', ate: '2026-10-13', entrou: 100 })
    })

    it('recebimento desfeito não conta', async () => {
      await manual('APORTE', 1000, '2026-10-01')
      const tr = await recibo(300, ONTEM)
      await db!('transacoes_recebimento').where({ id: tr }).update({ desfeita_em: new Date() })
      expect(await previa(ONTEM)).toMatchObject({ entrou: 0, itens: [] })
    })

    it('recusa dia futuro, inválido ou antes do último fechado', async () => {
      await fechar('2026-10-13')
      expect((await req('GET', '/api/caixa/fechamentos/previa?dia=2026-10-16', 'admin')).statusCode).toBe(400)
      expect((await req('GET', '/api/caixa/fechamentos/previa?dia=banana', 'admin')).statusCode).toBe(400)
      expect((await req('GET', '/api/caixa/fechamentos/previa', 'admin')).statusCode).toBe(400)
      expect((await req('GET', '/api/caixa/fechamentos/previa?dia=2026-10-12', 'admin')).statusCode).toBe(409)
    })
  })
})
