import type { FastifyInstance } from 'fastify'
import type { Knex } from 'knex'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { createAuditoriaRepository } from '../src/modules/auditoria/models/repository.js'
import { createSessoesRepository, createUsuariosRepository } from '../src/modules/auth/models/repository.js'
import { createAuthService } from '../src/modules/auth/services/auth.service.js'
import { hashSenha } from '../src/modules/auth/services/password.js'
import { createTokensService } from '../src/modules/auth/services/tokens.js'
import { createConfigRepository } from '../src/modules/config/models/repository.js'
import { createConfigService } from '../src/modules/config/services/config.service.js'
import { createEmprestimosRepository } from '../src/modules/emprestimos/models/repository.js'
import { createEmprestimosService } from '../src/modules/emprestimos/services/emprestimos.service.js'
import { createEstoqueRepository } from '../src/modules/estoque/models/repository.js'
import { createEstoqueService } from '../src/modules/estoque/services/estoque.service.js'
import { createIndicadoresRepository } from '../src/modules/indicadores/models/repository.js'
import { createIndicadoresService } from '../src/modules/indicadores/services/indicadores.service.js'
import { createRecebimentosRepository } from '../src/modules/recebimentos/models/repository.js'
import { createRecebimentosService } from '../src/modules/recebimentos/services/recebimentos.service.js'
import { createRepassesRepository } from '../src/modules/repasses/models/repository.js'
import { createRepassesService } from '../src/modules/repasses/services/repasses.service.js'
import { createVendasRepository } from '../src/modules/vendas/models/repository.js'
import { createVendasService } from '../src/modules/vendas/services/vendas.service.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()
const SENHA = 'senha-forte-123'

describe.skipIf(!db)('repasse do indicador (Postgres de verdade)', () => {
  let app: FastifyInstance
  let hoje = '2026-10-08'
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}

  const req = (metodo: 'GET' | 'POST', url: string, papel?: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  const pagar = (ind: number, corpo: object = {}, papel = 'admin') => req('POST', `/api/indicadores/${ind}/repasses`, papel, { valor: 100, forma: 'PIX', ...corpo })
  const detalhe = async (ind: number, papel = 'admin') => (await req('GET', `/api/indicadores/${ind}/repasse`, papel)).json()

  /** Venda de 3.000 (aparelho com custo 2.000), entrada 600 e 4 parcelas de 840: total 3.960, lucro 1.960, 50% = 980. */
  async function venda(indicador: number | null = id.roberto): Promise<number> {
    const [b] = await db!('bens').insert({ modelo: 'iPhone 13', gb: 128, cor: 'Preto', preco_venda: 3000, valor_compra: 2000, data_compra: '2026-09-01' }).returning('id')
    const r = await req('POST', '/api/vendas', 'admin', { aparelhoId: b.id, clienteId: id.cA, preco: 3000, entrada: 600, parcelas: 4, diaVencimento: 10, ...(indicador ? { indicadorId: indicador } : {}) })
    expect(r.statusCode).toBe(201)
    return r.json().id
  }
  /** Recebe a parcela e devolve o id do recibo (para desfazer). */
  const receber = async (v: number, parcela: number, valor = 840): Promise<number> => {
    const r = await req('POST', `/api/vendas/${v}/recebimentos`, 'admin', { forma: 'PIX', parcela, valor })
    expect(r.statusCode).toBe(201)
    return r.json().recibo.id
  }
  /** Parcelado de 1.000 a 30% no total em 1x: o cliente paga 1.300, lucro 300. */
  async function emprestimo(indicador: number | null = id.roberto): Promise<number> {
    const r = await req('POST', '/api/emprestimos', 'admin', { clienteId: id.cA, modalidade: 'PARCELADO', capital: 1000, taxa: 30, parcelas: 1, ...(indicador ? { indicadorId: indicador } : {}) })
    expect(r.statusCode).toBe(201)
    return r.json().id
  }

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    await k('sistema_config').where({ chave: 'juros_parcela_pct' }).update({ valor: JSON.stringify(10) })
    await k('sistema_config').where({ chave: 'max_parcelas' }).update({ valor: JSON.stringify(10) })
    const hash = await hashSenha(SENHA)
    for (const [chave, nome] of [['roberto', 'Roberto'], ['carla', 'Carla']] as const) {
      const [i] = await k('indicadores').insert({ nome, pct: 0.5, pct_manual: true }).returning('id')
      id[chave] = i.id
    }
    for (const [chave, perfil, extra] of [['admin', 'ADMIN', {}], ['vendedor', 'VENDEDOR', {}], ['cobrador', 'COBRADOR', {}], ['indicador', 'INDICADOR', { indicador_id: id.roberto }], ['indicador2', 'INDICADOR', { indicador_id: id.carla }]] as const) {
      const [u] = await k('users').insert({ nome: `${chave} Silva`, email: `${chave}@t.com`, senha_hash: hash, perfil, ...extra }).returning('id')
      id[chave] = u.id
    }
    const [c] = await k('clientes').insert({ nome: 'Ana Souza', fone: '11988124410' }).returning('id')
    id.cA = c.id

    const tokens = createTokensService('x'.repeat(40), '15m')
    const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
    const audit = createAuditoriaRepository(k)
    const indRepo = createIndicadoresRepository(k)
    const indicadores = createIndicadoresService(indRepo, audit)
    const config = createConfigRepository(k)
    const vendasRepo = createVendasRepository(k)
    const empRepo = createEmprestimosRepository(k)
    app = await buildApp({
      env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, clientes: {} as never, usuarios: {} as never, indicadores,
      estoque: createEstoqueService(createEstoqueRepository(k), audit), config: createConfigService(config),
      vendas: createVendasService({ vendas: vendasRepo, config, auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis(), hoje: () => hoje }),
      emprestimos: createEmprestimosService({ emprestimos: empRepo, auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis(), hoje: () => hoje }),
      recebimentos: createRecebimentosService({ repo: createRecebimentosRepository(k), auditoria: audit, hoje: () => hoje }),
      repasses: createRepassesService({ repo: createRepassesRepository(k), indicadores: indRepo, vendas: vendasRepo, emprestimos: empRepo, auditoria: audit, hoje: () => hoje }),
      aprovacoes: {} as never, fechamentos: {} as never, equipe: {} as never,
      limites: { vendasPorMinuto: 100_000, recebimentosPorMinuto: 100_000 },
    })
    for (const papel of ['admin', 'vendedor', 'cobrador', 'indicador', 'indicador2']) t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  })
  beforeEach(async () => {
    hoje = '2026-10-08'
    const k = db!
    for (const tb of ['repasses_indicador', 'recebimentos', 'transacoes_recebimento', 'venda_parcelas', 'emprestimo_parcelas', 'vendas', 'emprestimos', 'bens']) await k(tb).del()
    await k('indicadores').update({ pct: 0.5 })
  })
  afterAll(async () => { await app?.close(); await db?.destroy() })

  describe('quem pode ver e pagar', () => {
    it('resumo geral: só o administrador (403 para os outros, 401 sem login)', async () => {
      expect((await req('GET', '/api/repasses', 'admin')).statusCode).toBe(200)
      for (const papel of ['vendedor', 'cobrador', 'indicador']) expect((await req('GET', '/api/repasses', papel)).statusCode).toBe(403)
      expect((await req('GET', '/api/repasses')).statusCode).toBe(401)
      expect((await req('GET', '/api/repasses/pagos', 'indicador')).statusCode).toBe(403)
    })
    it('só o administrador paga (403 para os outros, inclusive o próprio indicador)', async () => {
      const v = await venda(); await receber(v, 1); await receber(v, 2); await receber(v, 3)
      for (const papel of ['vendedor', 'cobrador', 'indicador']) expect((await pagar(id.roberto, {}, papel)).statusCode).toBe(403)
      expect((await req('POST', `/api/indicadores/${id.roberto}/repasses`, undefined, { valor: 1, forma: 'PIX' })).statusCode).toBe(401)
      expect((await detalhe(id.roberto)).repasses).toHaveLength(0)
    })
    it('o indicador vê só o repasse dele: o de outro indicador é 404, igual a um que não existe', async () => {
      expect((await req('GET', `/api/indicadores/${id.roberto}/repasse`, 'indicador')).statusCode).toBe(200)
      expect((await req('GET', `/api/indicadores/${id.carla}/repasse`, 'indicador')).statusCode).toBe(404)
      expect((await req('GET', `/api/indicadores/999999/repasse`, 'indicador')).statusCode).toBe(404)
      expect((await req('GET', `/api/indicadores/${id.roberto}/repasse`, 'vendedor')).statusCode).toBe(403)
      expect((await req('GET', `/api/indicadores/${id.roberto}/repasse`, 'cobrador')).statusCode).toBe(403)
    })
    it('id inválido 400; indicador inexistente 404 (admin)', async () => {
      expect((await req('GET', '/api/indicadores/abc/repasse', 'admin')).statusCode).toBe(400)
      expect((await req('GET', '/api/indicadores/999999/repasse', 'admin')).statusCode).toBe(404)
      expect((await pagar(999999)).statusCode).toBe(404)
    })
    it('o repasse do indicador nunca traz o capital da loja (custo do aparelho, valor emprestado), mas o do admin traz', async () => {
      const v = await venda(); await receber(v, 1)
      await emprestimo()
      const dele = await detalhe(id.roberto, 'indicador')
      expect(dele.operacoes).toHaveLength(2)
      for (const o of dele.operacoes) expect('investido' in o).toBe(false)
      expect(JSON.stringify(dele)).not.toMatch(/investido/)
      expect(dele.operacoes.every((o: { capitalVoltou: boolean; parte: number }) => typeof o.capitalVoltou === 'boolean' && o.parte > 0)).toBe(true)
      const doAdmin = await detalhe(id.roberto, 'admin')
      expect(doAdmin.operacoes.every((o: { investido: number }) => o.investido > 0)).toBe(true)
    })
    it('os detalhes de um indicador nunca trazem operação de outro', async () => {
      await venda(id.roberto); await venda(id.carla)
      const r = await detalhe(id.roberto, 'indicador')
      expect(r.nOperacoes).toBe(1)
      expect(JSON.stringify(r)).not.toContain('Carla')
    })
  })

  describe('o que está liberado (exemplo do plano)', () => {
    it('só a entrada de 600: o capital (2.000) ainda não voltou, nada liberado; vai liberar 980 (50% de 1.960)', async () => {
      await venda()
      const r = await detalhe(id.roberto)
      expect(r.resumo).toMatchObject({ liberado: 0, pago: 0, aPagar: 0, vaiLiberar: 980 })
      expect(r.operacoes[0]).toMatchObject({ tipo: 'VENDA', capitalVoltou: false, parte: 980, clienteNome: 'Ana Souza' })
    })
    it('o capital volta e o que passa dele libera 50%: 600 + 3×840 = 3.120 → lucro 1.120 → 560', async () => {
      const v = await venda(); await receber(v, 1); await receber(v, 2); await receber(v, 3)
      const r = await detalhe(id.roberto)
      expect(r.operacoes[0].capitalVoltou).toBe(true)
      expect(r.resumo).toMatchObject({ liberado: 560, aPagar: 560, vaiLiberar: 420 })
    })
    it('venda quitada libera os 980 inteiros', async () => {
      const v = await venda(); for (const p of [1, 2, 3, 4]) await receber(v, p)
      expect((await detalhe(id.roberto)).resumo).toMatchObject({ liberado: 980, aPagar: 980, vaiLiberar: 0 })
    })
    it('venda sem indicador não entra em repasse nenhum', async () => {
      const v = await venda(null); for (const p of [1, 2, 3, 4]) await receber(v, p)
      expect((await detalhe(id.roberto)).nOperacoes).toBe(0)
    })
    it('venda cancelada não conta', async () => {
      const v = await venda(); for (const p of [1, 2, 3, 4]) await receber(v, p)
      await db!('vendas').where({ id: v }).update({ status: 'CANCELADA' })
      expect((await detalhe(id.roberto)).resumo.liberado).toBe(0)
    })
    it('empréstimo também: capital 1.000, cliente paga 1.300, lucro 300, 50% = 150', async () => {
      const e = await emprestimo()
      let r = await detalhe(id.roberto)
      expect(r.operacoes[0]).toMatchObject({ tipo: 'EMPRESTIMO', parte: 150, liberado: 0 })
      expect((await req('POST', `/api/emprestimos/${e}/recebimentos`, 'admin', { forma: 'PIX', parcela: 1, valor: 1300 })).statusCode).toBe(201)
      r = await detalhe(id.roberto)
      expect(r.resumo).toMatchObject({ liberado: 150, aPagar: 150, vaiLiberar: 0 })
    })
    it('empréstimo sem indicador não entra em repasse nenhum', async () => {
      const e = await emprestimo(null)
      await req('POST', `/api/emprestimos/${e}/recebimentos`, 'admin', { forma: 'PIX', parcela: 1, valor: 1300 })
      expect((await detalhe(id.roberto)).nOperacoes).toBe(0)
    })
    it('empréstimo usa o % congelado dele (30%), mesmo se o indicador passar a 50% depois', async () => {
      await db!('indicadores').where({ id: id.roberto }).update({ pct: 0.3 })
      const e = await emprestimo() // lucro 300 × 30% = 90
      await db!('indicadores').where({ id: id.roberto }).update({ pct: 0.5 })
      await req('POST', `/api/emprestimos/${e}/recebimentos`, 'admin', { forma: 'PIX', parcela: 1, valor: 1300 })
      expect((await detalhe(id.roberto)).operacoes[0]).toMatchObject({ pct: 0.3, parte: 90, liberado: 90 })
    })
    it('venda e empréstimo do mesmo indicador somam no mesmo repasse', async () => {
      const v = await venda(); for (const p of [1, 2, 3, 4]) await receber(v, p)
      const e = await emprestimo()
      await req('POST', `/api/emprestimos/${e}/recebimentos`, 'admin', { forma: 'PIX', parcela: 1, valor: 1300 })
      const r = await detalhe(id.roberto)
      expect(r.nOperacoes).toBe(2)
      expect(r.resumo.liberado).toBe(1130)
    })
    it('o % fica congelado: mudar o % do indicador depois não altera a operação antiga', async () => {
      const v = await venda(); for (const p of [1, 2, 3, 4]) await receber(v, p)
      await db!('indicadores').where({ id: id.roberto }).update({ pct: 0.3 })
      expect((await detalhe(id.roberto)).resumo.liberado).toBe(980)
    })
    it('o resumo geral lista todos os indicadores, inclusive quem não tem operação', async () => {
      const v = await venda(); for (const p of [1, 2, 3, 4]) await receber(v, p)
      const r = (await req('GET', '/api/repasses', 'admin')).json()
      const por = Object.fromEntries(r.map((x: { indicador: { nome: string } }) => [x.indicador.nome, x]))
      expect(por.Roberto.resumo.aPagar).toBe(980)
      expect(por.Carla).toMatchObject({ nOperacoes: 0, resumo: { liberado: 0, pago: 0, aPagar: 0, vaiLiberar: 0 } })
    })
  })

  describe('pagar o repasse', () => {
    async function liberado980() { const v = await venda(); for (const p of [1, 2, 3, 4]) await receber(v, p) }

    it('paga parcial: guarda data, forma e quem pagou, e o a pagar cai', async () => {
      await liberado980()
      const r = await pagar(id.roberto, { valor: 300, forma: 'DINHEIRO', data: '2026-10-05', obs: 'adiantamento' })
      expect(r.statusCode).toBe(201)
      expect(r.json().repasse).toMatchObject({ valor: 300, forma: 'DINHEIRO', data: '2026-10-05', obs: 'adiantamento', feitoPor: 'admin Silva', indicadorNome: 'Roberto' })
      expect(r.json().detalhe.resumo).toMatchObject({ liberado: 980, pago: 300, aPagar: 680 })
    })
    it('a data padrão é hoje', async () => {
      await liberado980()
      expect((await pagar(id.roberto)).json().repasse.data).toBe('2026-10-08')
    })
    it('paga tudo e depois não há mais nada: mais um centavo é recusado (409)', async () => {
      await liberado980()
      expect((await pagar(id.roberto, { valor: 980 })).statusCode).toBe(201)
      const r = await pagar(id.roberto, { valor: 0.01 })
      expect(r.statusCode).toBe(409)
      expect(r.json().codigo).toBe('VALOR_ACIMA_DO_LIBERADO')
      expect((await detalhe(id.roberto)).resumo).toMatchObject({ pago: 980, aPagar: 0 })
    })
    it('não deixa pagar mais do que está a pagar e diz quanto é', async () => {
      await liberado980()
      await pagar(id.roberto, { valor: 900 })
      const r = await pagar(id.roberto, { valor: 80.01 })
      expect(r.statusCode).toBe(409)
      expect(r.json().mensagem ?? r.json().message ?? JSON.stringify(r.json())).toContain('80,00')
      expect((await pagar(id.roberto, { valor: 80 })).statusCode).toBe(201)
    })
    it('não paga nada enquanto o capital não voltou', async () => {
      await venda()
      expect((await pagar(id.roberto, { valor: 1 })).statusCode).toBe(409)
    })
    it('o pagamento abate a operação mais antiga primeiro', async () => {
      const a = await venda(); for (const p of [1, 2, 3, 4]) await receber(a, p)
      hoje = '2026-10-20'
      const b = await venda(); for (const p of [1, 2, 3, 4]) await receber(b, p)
      const r = (await pagar(id.roberto, { valor: 1200 })).json().detalhe
      expect(r.operacoes.map((o: { id: number; pagoNela: number }) => [o.id, o.pagoNela])).toEqual([[a, 980], [b, 220]])
    })
    it.each([
      ['sem valor', { valor: undefined }], ['valor zero', { valor: 0 }], ['valor negativo', { valor: -5 }], ['valor como texto', { valor: '100' }], ['valor gigante', { valor: 1e9 }], ['valor NaN', { valor: null }],
      ['sem forma', { forma: undefined }], ['forma inválida', { forma: 'CARTAO' }], ['data inválida', { data: '2026-02-31' }], ['data futura', { data: '2026-10-09' }], ['data antiga demais', { data: '2019-12-31' }], ['obs enorme', { obs: 'x'.repeat(301) }],
    ])('recusa %s (400) e não grava nada', async (_n, m) => {
      await liberado980()
      const corpo = { valor: 100, forma: 'PIX', ...m } as Record<string, unknown>
      for (const k of Object.keys(corpo)) if (corpo[k] === undefined) delete corpo[k]
      expect((await req('POST', `/api/indicadores/${id.roberto}/repasses`, 'admin', corpo)).statusCode).toBe(400)
      expect((await detalhe(id.roberto)).repasses).toHaveLength(0)
    })
    it('duas chamadas ao mesmo tempo pelo valor todo: uma passa, a outra leva 409 (nunca paga em dobro)', async () => {
      await liberado980()
      const rs = await Promise.all([pagar(id.roberto, { valor: 980 }), pagar(id.roberto, { valor: 980 }), pagar(id.roberto, { valor: 980 })])
      expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409, 409])
      expect((await detalhe(id.roberto)).resumo).toMatchObject({ pago: 980, aPagar: 0 })
    })
    it('pagamento ao Roberto não mexe no que se deve à Carla', async () => {
      await liberado980()
      const [b] = await db!('bens').insert({ modelo: 'iPhone 12', gb: 64, cor: 'Azul', preco_venda: 3000, valor_compra: 2000, data_compra: '2026-09-01' }).returning('id')
      const rv = await req('POST', '/api/vendas', 'admin', { aparelhoId: b.id, clienteId: id.cA, preco: 3000, entrada: 600, parcelas: 4, diaVencimento: 10, indicadorId: id.carla })
      for (const p of [1, 2, 3, 4]) await receber(rv.json().id, p)
      await pagar(id.roberto, { valor: 980 })
      expect((await detalhe(id.carla)).resumo).toMatchObject({ pago: 0, aPagar: 980 })
    })
    it('a lista de já pagos vem do mais novo ao mais antigo e filtra por indicador', async () => {
      await liberado980()
      await pagar(id.roberto, { valor: 100, data: '2026-10-01' }); await pagar(id.roberto, { valor: 200, data: '2026-10-07' })
      const todos = (await req('GET', '/api/repasses/pagos', 'admin')).json()
      expect(todos.map((r: { valor: number }) => r.valor)).toEqual([200, 100])
      expect((await req('GET', `/api/repasses/pagos?indicadorId=${id.carla}`, 'admin')).json()).toEqual([])
      expect((await req('GET', '/api/repasses/pagos?indicadorId=abc', 'admin')).statusCode).toBe(400)
    })
    it('desfazer o último recebimento depois do repasse mostra "pago a mais" e nada a pagar', async () => {
      const v = await venda(); let ultimo = 0
      for (const p of [1, 2, 3, 4]) ultimo = await receber(v, p)
      await pagar(id.roberto, { valor: 980 })
      expect((await req('POST', `/api/recebimentos/${ultimo}/desfazer`, 'admin')).statusCode).toBe(204)
      const r = (await detalhe(id.roberto)).resumo
      expect(r).toMatchObject({ liberado: 560, pago: 980, aPagar: 0, pagoAMais: 420 })
      expect((await pagar(id.roberto, { valor: 1 })).statusCode).toBe(409)
    })
    it('registra na auditoria', async () => {
      await liberado980()
      await pagar(id.roberto, { valor: 250, forma: 'TRANSFERENCIA' })
      const l = await db!('auditoria').where({ acao: 'REPASSE_PAGO' }).first()
      expect(l).toBeTruthy()
      expect(l.entidade).toBe('indicador')
    })
  })
})
