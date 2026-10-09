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
import { jurosRecebidosSoJuros } from '../src/modules/emprestimos/services/calculo.js'
import { createEmprestimosService } from '../src/modules/emprestimos/services/emprestimos.service.js'
import { createEstoqueRepository } from '../src/modules/estoque/models/repository.js'
import { createEstoqueService } from '../src/modules/estoque/services/estoque.service.js'
import { createIndicadoresRepository } from '../src/modules/indicadores/models/repository.js'
import { createIndicadoresService } from '../src/modules/indicadores/services/indicadores.service.js'
import { createRecebimentosRepository } from '../src/modules/recebimentos/models/repository.js'
import { createRecebimentosService } from '../src/modules/recebimentos/services/recebimentos.service.js'
import { createRepassesRepository } from '../src/modules/repasses/models/repository.js'
import { calcularRepasse, partesDoIndicador } from '../src/modules/repasses/services/calculo.js'
import { createRepassesService } from '../src/modules/repasses/services/repasses.service.js'
import { createVendasRepository } from '../src/modules/vendas/models/repository.js'
import { createVendasService } from '../src/modules/vendas/services/vendas.service.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const parcela = (numero: number, valor: number, pago: number, acordo: string | null = null) => ({ numero, valor, pago, acordo })
const soJuros = (o: Partial<Parameters<typeof jurosRecebidosSoJuros>[0]> = {}) => ({ modalidade: 'JUROS' as const, modoDivisao: 'JUROS_MENSAL', capital: 3000, amortizado: 0, parcelas: [parcela(1, 300, 0), parcela(2, 300, 0), parcela(3, 3300, 0)], ...o })

describe('juros recebidos no só juros (modo JUROS_MENSAL)', () => {
  it('nada pago: zero', () => { expect(jurosRecebidosSoJuros(soJuros())).toBe(0) })
  it('só os juros pagos contam (300 + 300)', () => { expect(jurosRecebidosSoJuros(soJuros({ parcelas: [parcela(1, 300, 300), parcela(2, 300, 300), parcela(3, 3300, 0)] }))).toBe(600) })
  it('a última parcela leva o capital: pagou 3.300 = 300 de juro + 3.000 de capital → só 300 é juro', () => {
    expect(jurosRecebidosSoJuros(soJuros({ parcelas: [parcela(1, 300, 300), parcela(2, 300, 300), parcela(3, 3300, 3300)] }))).toBe(900)
  })
  it('a última parcela paga só em parte: primeiro vem o juro (300), o resto é capital', () => {
    expect(jurosRecebidosSoJuros(soJuros({ parcelas: [parcela(1, 300, 300), parcela(2, 300, 300), parcela(3, 3300, 1000)] }))).toBe(600 + 300) // 1000 = 300 de juro + 700 de capital
  })
  it('capital amortizado adiantado não é juro (o que entra como entrada fica fora)', () => {
    // 500 de capital já amortizado: o capital em aberto é 2.500, a última parcela é 300 (juro) + 2.500
    expect(jurosRecebidosSoJuros(soJuros({ amortizado: 500, parcelas: [parcela(1, 300, 300), parcela(2, 300, 300), parcela(3, 2800, 2800)] }))).toBe(900)
  })
  it('só vale no modo JUROS_MENSAL e só no só juros; depois de um acordo vale capital primeiro (null)', () => {
    expect(jurosRecebidosSoJuros(soJuros({ modoDivisao: 'CAPITAL_PRIMEIRO' }))).toBeNull()
    expect(jurosRecebidosSoJuros({ ...soJuros(), modalidade: 'PARCELADO' as never })).toBeNull()
    expect(jurosRecebidosSoJuros(soJuros({ parcelas: [parcela(1, 300, 300), parcela(2, 300, 0, 'NOVA')] }))).toBeNull()
  })
  it('sem parcelas: zero, sem quebrar', () => { expect(jurosRecebidosSoJuros(soJuros({ parcelas: [] }))).toBe(0) })
})

describe('o repasse no modo JUROS_MENSAL (cálculo puro)', () => {
  const op = (o = {}) => ({ tipo: 'EMPRESTIMO' as const, id: 1, data: '2026-09-01', clienteNome: 'A', descricao: 'Empréstimo só juros', status: 'ATIVA' as const, pct: 0.5, investido: 3000, total: 3900, descontos: 0, recebido: 600, ...o })
  it('o indicador recebe o % dos juros a cada pagamento, sem esperar o capital: 600 de juros × 50% = 300', () => {
    const r = calcularRepasse([op({ jurosRecebidos: 600 })], 0)
    expect(r.liberado).toBe(300); expect(r.operacoes[0].parte).toBe(450); expect(r.vaiLiberar).toBe(150)
  })
  it('na regra normal (capital primeiro), os mesmos 600 recebidos ainda não liberam nada', () => {
    expect(calcularRepasse([op()], 0).liberado).toBe(0)
  })
  it('quitado: libera a parte inteira (900 de juros × 50%)', () => {
    const r = calcularRepasse([op({ status: 'QUITADA', recebido: 3900, jurosRecebidos: 900 })], 0)
    expect(r).toMatchObject({ liberado: 450, vaiLiberar: 0 })
  })
  it('jurosRecebidos zero ou negativo não gera repasse negativo', () => {
    expect(calcularRepasse([op({ jurosRecebidos: 0 })], 0).liberado).toBe(0)
    expect(partesDoIndicador({ total: 3900, descontos: 0, recebido: 600, investido: 3000, pct: 0.5, jurosRecebidos: -5 }).liberado).toBe(0)
  })
  it('abate o já pago, da operação mais antiga para a mais nova, como sempre', () => {
    const r = calcularRepasse([op({ id: 2, data: '2026-10-01', jurosRecebidos: 200 }), op({ id: 1, jurosRecebidos: 600 })], 350)
    expect(r.operacoes.map((o) => [o.id, o.pagoNela])).toEqual([[1, 300], [2, 50]])
  })
})

const db: Knex | null = await bancoDeTeste()
const SENHA = 'senha-forte-123'
describe.skipIf(!db)('empréstimo só juros com divisão a cada pagamento (Postgres de verdade)', () => {
  let app: FastifyInstance
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}
  const hoje = '2026-10-08'
  const req = (metodo: 'GET' | 'POST', url: string, papel?: string, payload?: object) => app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  /** Só juros de 3.000 a 10% por parcela em 3x (300, 300, 3.300), do Roberto (50%). */
  async function emprestimo(extra: object = {}) {
    const r = await req('POST', '/api/emprestimos', 'admin', { clienteId: id.ana, modalidade: 'JUROS', capital: 3000, taxa: 10, parcelas: 3, indicadorId: id.roberto, ...extra })
    expect(r.statusCode, r.body).toBe(201)
    return r.json().id as number
  }
  const receber = (e: number, parcela: number, valor: number) => req('POST', `/api/emprestimos/${e}/recebimentos`, 'admin', { forma: 'PIX', parcela, valor })
  const detalhe = async (papel = 'admin') => (await req('GET', `/api/indicadores/${id.roberto}/repasse`, papel)).json()

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    const hash = await hashSenha(SENHA)
    const [i] = await k('indicadores').insert({ nome: 'Roberto', pct: 0.5, pct_manual: true }).returning('id'); id.roberto = i.id
    for (const [chave, perfil, extra] of [['admin', 'ADMIN', {}], ['indicador', 'INDICADOR', { indicador_id: id.roberto }], ['cobrador', 'COBRADOR', {}]] as const) {
      const [u] = await k('users').insert({ nome: `${chave} Silva`, email: `${chave}@t.com`, senha_hash: hash, perfil, ...extra }).returning('id'); id[chave] = u.id
    }
    const [c] = await k('clientes').insert({ nome: 'ANA SOUZA', fone: '11988124410' }).returning('id'); id.ana = c.id
    const tokens = createTokensService('x'.repeat(40), '15m')
    const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
    const audit = createAuditoriaRepository(k)
    const indRepo = createIndicadoresRepository(k)
    const indicadores = createIndicadoresService(indRepo, audit)
    const config = createConfigRepository(k)
    const vendasRepo = createVendasRepository(k); const empRepo = createEmprestimosRepository(k)
    app = await buildApp({
      env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, clientes: {} as never, usuarios: {} as never, indicadores,
      estoque: createEstoqueService(createEstoqueRepository(k), audit), config: createConfigService(config),
      vendas: createVendasService({ vendas: vendasRepo, config, auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis(), hoje: () => hoje }),
      emprestimos: createEmprestimosService({ emprestimos: empRepo, auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis(), hoje: () => hoje }),
      recebimentos: createRecebimentosService({ repo: createRecebimentosRepository(k), auditoria: audit, hoje: () => hoje }),
      repasses: createRepassesService({ repo: createRepassesRepository(k), indicadores: indRepo, vendas: vendasRepo, emprestimos: empRepo, auditoria: audit, hoje: () => hoje }),
      aprovacoes: {} as never, fechamentos: {} as never, equipe: {} as never, limites: { vendasPorMinuto: 100_000, recebimentosPorMinuto: 100_000 },
    })
    for (const papel of ['admin', 'indicador', 'cobrador']) t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  })
  beforeEach(async () => { for (const tb of ['repasses_indicador', 'recebimentos', 'transacoes_recebimento', 'emprestimo_parcelas', 'emprestimos']) await db!(tb).del() })
  afterAll(async () => { await app?.close(); await db?.destroy() })

  it('JUROS_MENSAL: o indicador recebe o % dos juros a cada pagamento, antes do capital voltar', async () => {
    const e = await emprestimo({ modoDivisao: 'JUROS_MENSAL' })
    expect((await receber(e, 1, 300)).statusCode).toBe(201)
    expect((await detalhe()).resumo).toMatchObject({ liberado: 150, aPagar: 150, vaiLiberar: 300 }) // 50% de 300; ainda vai liberar 50% dos outros 600
    expect((await receber(e, 2, 300)).statusCode).toBe(201)
    expect((await detalhe()).resumo).toMatchObject({ liberado: 300, vaiLiberar: 150 })
  })
  it('CAPITAL_PRIMEIRO (o padrão): os mesmos pagamentos de juros ainda não liberam nada', async () => {
    const e = await emprestimo()
    await receber(e, 1, 300); await receber(e, 2, 300)
    expect((await detalhe()).resumo).toMatchObject({ liberado: 0 })
    expect((await req('GET', `/api/emprestimos/${e}`, 'admin')).json().modoDivisao).toBe('CAPITAL_PRIMEIRO')
  })
  it('quitar (a última parcela leva o capital): o capital não gera repasse, só o juro dela; no fim os dois modos chegam ao mesmo valor', async () => {
    const e = await emprestimo({ modoDivisao: 'JUROS_MENSAL' })
    await receber(e, 1, 300); await receber(e, 2, 300)
    expect((await receber(e, 3, 3300)).statusCode).toBe(201)
    expect((await detalhe()).resumo).toMatchObject({ liberado: 450, vaiLiberar: 0 }) // 50% de 900 de juros
  })
  it('pagou a mais que o juro numa parcela: o excedente amortiza o capital e NÃO é juro (150, não 250)', async () => {
    const e = await emprestimo({ modoDivisao: 'JUROS_MENSAL' })
    expect((await receber(e, 1, 500)).statusCode).toBe(201)
    expect((await detalhe()).resumo.liberado).toBe(150)
  })
  it('o indicador vê a parte dele liberada no modo JUROS_MENSAL, sem capital nem lucro da loja', async () => {
    const e = await emprestimo({ modoDivisao: 'JUROS_MENSAL' })
    await receber(e, 1, 300)
    const lista = (await req('GET', '/api/emprestimos', 'indicador')).json()
    expect(lista.itens[0]).toMatchObject({ id: e, suaParte: 450, jaLiberado: 150 })
    expect(JSON.stringify(lista)).not.toMatch(/modoDivisao|capital|lucro/i)
  })
  it('só o admin vê o modo na ficha; cobrador não', async () => {
    const e = await emprestimo({ modoDivisao: 'JUROS_MENSAL' })
    expect((await req('GET', `/api/emprestimos/${e}`, 'admin')).json().modoDivisao).toBe('JUROS_MENSAL')
    expect('modoDivisao' in (await req('GET', `/api/emprestimos/${e}`, 'cobrador')).json()).toBe(false)
  })
  it.each([
    ['modo inventado', { modoDivisao: 'METADE' }], ['parcelado', { modalidade: 'PARCELADO', taxa: 30, modoDivisao: 'JUROS_MENSAL' }],
    ['sem indicador', { indicadorId: null, modoDivisao: 'JUROS_MENSAL' }], ['diária', { modalidade: 'DIARIA', periodicidade: 'DIARIA', taxa: 30, modoDivisao: 'JUROS_MENSAL' }],
  ])('recusa %s (400) e não cria nada', async (_n, m) => {
    const r = await req('POST', '/api/emprestimos', 'admin', { clienteId: id.ana, modalidade: 'JUROS', capital: 3000, taxa: 10, parcelas: 3, indicadorId: id.roberto, ...m })
    expect(r.statusCode).toBe(400)
    expect(await db!('emprestimos').count('* as n').first().then((l) => Number((l as { n: string }).n))).toBe(0)
  })
})
