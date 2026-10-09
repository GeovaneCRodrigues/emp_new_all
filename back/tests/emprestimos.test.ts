import type { FastifyInstance } from 'fastify'
import type { Knex } from 'knex'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { createAuditoriaRepository } from '../src/modules/auditoria/models/repository.js'
import { createSessoesRepository, createUsuariosRepository } from '../src/modules/auth/models/repository.js'
import { createAuthService } from '../src/modules/auth/services/auth.service.js'
import { hashSenha } from '../src/modules/auth/services/password.js'
import { createTokensService } from '../src/modules/auth/services/tokens.js'
import { createEmprestimosRepository } from '../src/modules/emprestimos/models/repository.js'
import { planoEmprestimo } from '../src/modules/emprestimos/services/calculo.js'
import { createEmprestimosService } from '../src/modules/emprestimos/services/emprestimos.service.js'
import { createIndicadoresRepository } from '../src/modules/indicadores/models/repository.js'
import { createIndicadoresService } from '../src/modules/indicadores/services/indicadores.service.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()
const SENHA = 'senha-forte-123'

const plano = (o: Partial<Parameters<typeof planoEmprestimo>[0]> & { capital: number; taxa: number; n: number; data: string }) => planoEmprestimo({ modalidade: 'PARCELADO', periodicidade: 'MENSAL', ...o })

describe('plano do empréstimo parcelado (puro): juro em % NO TOTAL', () => {
  it('3.000 a 30% no total em 6x são 6 parcelas de 650,00 (total 3.900) — exemplo do plano', () => {
    const p = plano({ capital: 3000, taxa: 30, n: 6, data: '2026-10-08' })
    expect(p).toHaveLength(6)
    expect(p.every((x) => x.valor === 650)).toBe(true)
  })
  it('exemplos de cálculo do plano: 6.000 de total = 100% (6 × 1.000); parcela de 700 em 6x = 4.200 = 40%', () => {
    expect(plano({ capital: 3000, taxa: 100, n: 6, data: '2026-10-08' })[0].valor).toBe(1000)
    expect(plano({ capital: 3000, taxa: 40, n: 6, data: '2026-10-08' })[0].valor).toBe(700)
  })
  it('pode passar de 100%: o cliente paga mais que o dobro', () => {
    expect(plano({ capital: 1000, taxa: 150, n: 5, data: '2026-10-08' })[0].valor).toBe(500) // 1000 × 2,5 ÷ 5
  })
  it('vencimentos mensais: 1º um mês depois, no mesmo dia', () => {
    const p = plano({ capital: 5000, taxa: 60, n: 6, data: '2026-06-25' })
    expect(p.every((x) => x.valor === 1333.34)).toBe(true) // 5000 × 1,6 ÷ 6
    expect(p.map((x) => x.vencimento)).toEqual(['2026-07-25', '2026-08-25', '2026-09-25', '2026-10-25', '2026-11-25', '2026-12-25'])
  })
  it('arredonda a parcela para cima no centavo', () => {
    expect(plano({ capital: 1000, taxa: 21, n: 3, data: '2026-01-10' })[0].valor).toBe(403.34) // 1000 × 1,21 ÷ 3 = 403,333…
  })
  it('dia 31 cai no último dia dos meses curtos e volta a 31 depois (sem 1º vencimento escolhido)', () => {
    expect(plano({ capital: 1000, taxa: 30, n: 3, data: '2026-01-31' }).map((x) => x.vencimento)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30'])
  })
  it('com 1º vencimento escolhido, vale o dia dele (28/02 → todo dia 28)', () => {
    expect(plano({ capital: 1000, taxa: 30, n: 3, data: '2026-01-31', primeira: '2026-02-28' }).map((x) => x.vencimento)).toEqual(['2026-02-28', '2026-03-28', '2026-04-28'])
  })
  it('1 parcela só: capital + juros do total', () => {
    expect(plano({ capital: 2000, taxa: 8, n: 1, data: '2026-05-15' })).toEqual([{ vencimento: '2026-06-15', valor: 2160 }])
  })
})

describe('frequência e 1º vencimento (puro)', () => {
  it('semanal com 1º vencimento em 15/10: 15/10, 22/10, 29/10… (exemplo do plano)', () => {
    expect(plano({ capital: 1000, taxa: 30, n: 4, data: '2026-10-08', periodicidade: 'SEMANAL', primeira: '2026-10-15' }).map((x) => x.vencimento)).toEqual(['2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05'])
  })
  it('quinzenal: de 15 em 15 dias', () => {
    expect(plano({ capital: 1000, taxa: 30, n: 3, data: '2026-10-08', periodicidade: 'QUINZENAL', primeira: '2026-10-23' }).map((x) => x.vencimento)).toEqual(['2026-10-23', '2026-11-07', '2026-11-22'])
  })
  it('sem 1º vencimento, o padrão é um período depois da data do empréstimo', () => {
    expect(plano({ capital: 1000, taxa: 30, n: 1, data: '2026-10-08', periodicidade: 'SEMANAL' })[0].vencimento).toBe('2026-10-15')
    expect(plano({ capital: 1000, taxa: 30, n: 1, data: '2026-10-08', periodicidade: 'QUINZENAL' })[0].vencimento).toBe('2026-10-23')
    expect(plano({ capital: 1000, taxa: 30, n: 1, data: '2026-10-08' })[0].vencimento).toBe('2026-11-08')
  })
  it('mensal usa o dia do 1º vencimento escolhido, não o dia do empréstimo', () => {
    expect(plano({ capital: 1000, taxa: 30, n: 3, data: '2026-10-08', primeira: '2026-11-31'.replace('31', '30') }).map((x) => x.vencimento)).toEqual(['2026-11-30', '2026-12-30', '2027-01-30'])
    expect(plano({ capital: 1000, taxa: 30, n: 3, data: '2026-10-08', primeira: '2026-11-20' }).map((x) => x.vencimento)).toEqual(['2026-11-20', '2026-12-20', '2027-01-20'])
  })
  it('só juros semanal: o juro é de cada semana e o capital vem na última', () => {
    const p = planoEmprestimo({ capital: 1000, modalidade: 'JUROS', periodicidade: 'SEMANAL', taxa: 10, n: 6, data: '2026-10-08' })
    expect(p.map((x) => x.valor)).toEqual([100, 100, 100, 100, 100, 1100]) // exemplo do plano: 5x de 100 e a última de 1.100
    expect(p[0].vencimento).toBe('2026-10-15')
  })
})

describe('plano do empréstimo só juros (puro)', () => {
  it('3.000 a 12% em 3x: 360, 360 e 3.360 (capital na última)', () => {
    const p = planoEmprestimo({ capital: 3000, modalidade: 'JUROS', periodicidade: 'MENSAL', taxa: 12, n: 3, data: '2026-05-10' })
    expect(p.map((x) => x.valor)).toEqual([360, 360, 3360])
    expect(p.map((x) => x.vencimento)).toEqual(['2026-06-10', '2026-07-10', '2026-08-10'])
  })
  it('1 parcela só: juro mais capital de uma vez', () => {
    expect(planoEmprestimo({ capital: 1000, modalidade: 'JUROS', periodicidade: 'MENSAL', taxa: 5, n: 1, data: '2026-01-31' })).toEqual([{ vencimento: '2026-02-28', valor: 1050 }])
  })
  it('arredonda o juro ao centavo (sem acumular erro)', () => {
    const p = planoEmprestimo({ capital: 1234.56, modalidade: 'JUROS', periodicidade: 'MENSAL', taxa: 7.5, n: 2, data: '2026-01-10' })
    expect(p.map((x) => x.valor)).toEqual([92.59, 1327.15])
  })
})

describe('plano do empréstimo diário (puro)', () => {
  const diaria = (o: { capital: number; taxa: number; n: number; data: string; primeira?: string }) => planoEmprestimo({ modalidade: 'DIARIA', periodicidade: 'DIARIA', ...o })
  it('pula domingo: sábado 03/10 → segunda 05, terça 06, quarta 07', () => {
    const p = diaria({ capital: 1000, taxa: 20, n: 3, data: '2026-10-03' })
    expect(p.map((x) => x.vencimento)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07'])
    expect(p.every((x) => x.valor === 400)).toBe(true) // 1000 × 1,2 ÷ 3
  })
  it('a taxa é do total: 1.000 a 20% em 24x → 50,00 por dia útil, nunca num domingo', () => {
    const p = diaria({ capital: 1000, taxa: 20, n: 24, data: '2026-09-24' })
    expect(p.every((x) => x.valor === 50)).toBe(true)
    expect(p.some((x) => new Date(x.vencimento + 'T12:00:00Z').getUTCDay() === 0)).toBe(false)
    expect(p).toHaveLength(24)
  })
  it('arredonda a parcela para cima no centavo', () => {
    expect(diaria({ capital: 600, taxa: 20, n: 7, data: '2026-10-01' })[0].valor).toBe(102.86) // 720 ÷ 7 = 102,857…
  })
  it('data de partida num domingo: a primeira parcela é a segunda seguinte', () => {
    expect(diaria({ capital: 100, taxa: 10, n: 1, data: '2026-10-04' })[0].vencimento).toBe('2026-10-05')
  })
  it('1º vencimento escolhido num domingo vai para a segunda e a contagem segue por dia útil', () => {
    expect(diaria({ capital: 100, taxa: 10, n: 3, data: '2026-10-01', primeira: '2026-10-04' }).map((x) => x.vencimento)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07'])
  })
})

describe.skipIf(!db)('empréstimos parcelados (Postgres de verdade)', () => {
  let app: FastifyInstance
  const hoje = '2026-10-08'
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}
  const req = (metodo: 'GET' | 'POST', url: string, papel?: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  const emprestar = (papel: string, corpo: object = {}) => req('POST', '/api/emprestimos', papel, { clienteId: id.cA, modalidade: 'PARCELADO', capital: 5000, taxa: 60, parcelas: 6, ...corpo })

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    const hash = await hashSenha(SENHA)
    const [i1, i2] = await k('indicadores').insert([{ nome: 'Roberto', pct: 0.5, pct_manual: true }, { nome: 'Inativo', pct: 0.3, ativo: false, pct_manual: true }]).returning('id')
    id.ind1 = i1.id; id.ind2 = i2.id
    for (const [chave, perfil, extra] of [['admin', 'ADMIN', {}], ['vendedor', 'VENDEDOR', {}], ['cobrador', 'COBRADOR', {}], ['cobrador2', 'COBRADOR', {}], ['indicador', 'INDICADOR', { indicador_id: i1.id }]] as const) {
      const [u] = await k('users').insert({ nome: `${chave} Silva`, email: `${chave}@t.com`, senha_hash: hash, perfil, ...extra }).returning('id')
      id[chave] = u.id
    }
    const cli = async (chave: string, nome: string, resp: number | null) => { const [c] = await k('clientes').insert({ nome, fone: '11988124410', responsavel_id: resp }).returning('id'); id[chave] = c.id }
    await cli('cA', 'Ana Souza', id.cobrador)
    await cli('cB', 'Bruno Lima', id.cobrador2)
    const tokens = createTokensService('x'.repeat(40), '15m')
    const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
    const audit = createAuditoriaRepository(k)
    const indicadores = createIndicadoresService(createIndicadoresRepository(k), audit)
    app = await buildApp({
      env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, clientes: {} as never, usuarios: {} as never, indicadores,
      estoque: {} as never, vendas: {} as never, config: {} as never, recebimentos: {} as never, aprovacoes: {} as never, fechamentos: {} as never, equipe: {} as never,
      emprestimos: createEmprestimosService({ emprestimos: createEmprestimosRepository(k), auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis(), hoje: () => hoje }),
      limites: { vendasPorMinuto: 100_000 },
    })
    for (const papel of ['admin', 'vendedor', 'cobrador', 'cobrador2', 'indicador']) t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  })
  afterAll(async () => { await app?.close(); await db?.destroy() })

  describe('criar', () => {
    it('só o administrador empresta (403 para os outros, 401 sem login)', async () => {
      for (const papel of ['vendedor', 'cobrador', 'indicador']) expect((await emprestar(papel)).statusCode).toBe(403)
      expect((await emprestar('')).statusCode).toBe(401)
    })
    it('cria com as parcelas calculadas pelo servidor, juros simples e capital como investido', async () => {
      const r = await emprestar('admin')
      expect(r.statusCode).toBe(201)
      const e = r.json()
      expect(e).toMatchObject({ cliente: { nome: 'Ana Souza' }, modalidade: 'PARCELADO', dataEmprestimo: hoje, capital: 5000, taxa: 60, periodicidade: 'MENSAL', nParcelas: 6, valorParcela: 1333.34, total: 8000.04, recebido: 0, falta: 8000.04, atrasadas: 0, status: 'ATIVA' })
      expect(e.lucroTotal).toBe(3000.04)
      expect(e.capitalDeVolta).toBe(0)
      expect(e.parcelas.map((p: { vencimento: string }) => p.vencimento)).toEqual(['2026-11-08', '2026-12-08', '2027-01-08', '2027-02-08', '2027-03-08', '2027-04-08'])
      const a = await db!('auditoria').where({ acao: 'EMPRESTIMO_CRIADO', entidade_id: e.id }).first()
      expect(a).toMatchObject({ usuario_id: id.admin })
    })
    it('cria com frequência semanal e 1º vencimento escolhido (exemplo do plano: 15/10, 22/10, 29/10…)', async () => {
      const r = await emprestar('admin', { periodicidade: 'SEMANAL', primeiroVencimento: '2026-10-15', parcelas: 4, capital: 1000, taxa: 30 })
      expect(r.statusCode).toBe(201)
      const e = r.json()
      expect(e).toMatchObject({ periodicidade: 'SEMANAL', nParcelas: 4, valorParcela: 325, total: 1300 })
      expect(e.parcelas.map((p: { vencimento: string }) => p.vencimento)).toEqual(['2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05'])
    })
    it('sem 1º vencimento: um período depois da data do empréstimo (quinzenal → +15 dias)', async () => {
      const e = (await emprestar('admin', { periodicidade: 'QUINZENAL', parcelas: 2 })).json()
      expect(e.parcelas.map((p: { vencimento: string }) => p.vencimento)).toEqual(['2026-10-23', '2026-11-07'])
    })
    it('data do empréstimo no passado: as parcelas partem dela; o atraso já aparece', async () => {
      const e = (await emprestar('admin', { dataEmprestimo: '2026-08-10', parcelas: 3 })).json()
      expect(e).toMatchObject({ dataEmprestimo: '2026-08-10' })
      expect(e.parcelas.map((p: { vencimento: string }) => p.vencimento)).toEqual(['2026-09-10', '2026-10-10', '2026-11-10'])
      expect(e.atrasadas).toBe(1) // a de 10/09 já venceu em relação a 08/10
    })
    it('diária: modalidade DIARIA com frequência diária; 1º vencimento num domingo vai para a segunda', async () => {
      const e = (await emprestar('admin', { modalidade: 'DIARIA', capital: 1000, taxa: 20, parcelas: 3, dataEmprestimo: '2026-10-01', primeiroVencimento: '2026-10-04' })).json()
      expect(e).toMatchObject({ modalidade: 'DIARIA', periodicidade: 'DIARIA', valorParcela: 400 })
      expect(e.parcelas.map((p: { vencimento: string }) => p.vencimento)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07'])
    })
    it.each([
      ['frequência inventada', { periodicidade: 'ANUAL' }], ['diária com frequência mensal', { modalidade: 'DIARIA', periodicidade: 'MENSAL', taxa: 20 }],
      ['parcelado com frequência diária', { periodicidade: 'DIARIA' }], ['só juros com frequência diária', { modalidade: 'JUROS', periodicidade: 'DIARIA', taxa: 12 }],
      ['data do empréstimo no futuro', { dataEmprestimo: '2026-10-09' }], ['data do empréstimo inválida', { dataEmprestimo: '2026-02-31' }], ['data do empréstimo antiga demais', { dataEmprestimo: '2019-12-31' }],
      ['1º vencimento antes do empréstimo', { primeiroVencimento: '2026-10-07' }], ['1º vencimento inválido', { primeiroVencimento: 'amanhã' }], ['1º vencimento daqui a mais de um ano', { primeiroVencimento: '2027-10-10' }],
      
    ])('recusa %s (400)', async (_n, m) => {
      expect((await emprestar('admin', m)).statusCode).toBe(400)
    })
    it('aceita 1º vencimento no mesmo dia do empréstimo e juros acima de 100% no total', async () => {
      const r = await emprestar('admin', { primeiroVencimento: '2026-10-08', taxa: 150, capital: 1000, parcelas: 5 })
      expect(r.statusCode).toBe(201)
      expect(r.json()).toMatchObject({ valorParcela: 500, total: 2500 })
    })
    it('ignora totais e parcelas mandados pela tela', async () => {
      const r = await emprestar('admin', { total: 1, valorParcela: 1, lucro: 99999, parcelasCalculadas: [] })
      expect(r.json()).toMatchObject({ total: 8000.04, dataEmprestimo: hoje })
    })
    it('congela o % do indicador; mudar o indicador depois não muda o empréstimo', async () => {
      const e = (await emprestar('admin', { indicadorId: id.ind1 })).json()
      expect(e).toMatchObject({ percentualIndicador: 0.5, indicador: { nome: 'Roberto' }, parteIndicador: 1500.02 })
      await db!('indicadores').where({ id: id.ind1 }).update({ pct: 0.1 })
      const de = (await req('GET', `/api/emprestimos/${e.id}`, 'admin')).json()
      expect(de.percentualIndicador).toBe(0.5)
      await db!('indicadores').where({ id: id.ind1 }).update({ pct: 0.5 })
    })
    it.each([
      ['sem cliente', { clienteId: undefined }], ['cliente como texto', { clienteId: '1' }], ['modalidade inventada', { modalidade: 'SEMANAL' }],
      ['capital zero', { capital: 0 }], ['capital negativo', { capital: -10 }], ['capital como texto', { capital: '5000' }], ['capital gigante', { capital: 1e12 }],
      ['taxa zero', { taxa: 0 }], ['taxa acima de 999', { taxa: 1000 }], ['só juros com taxa acima de 100', { modalidade: 'JUROS', taxa: 101 }], ['taxa como texto', { taxa: '10' }],
      ['zero parcelas', { parcelas: 0 }], ['parcelas quebradas', { parcelas: 2.5 }], ['parcelas demais', { parcelas: 121 }], ['sem parcelas', { parcelas: undefined }],
      ['observações enormes', { observacoes: 'x'.repeat(501) }], 
    ])('recusa %s (400)', async (_n, m) => {
      const corpo = { clienteId: id.cA, modalidade: 'PARCELADO', capital: 5000, taxa: 60, parcelas: 6, ...m } as Record<string, unknown>
      for (const k of Object.keys(corpo)) if (corpo[k] === undefined) delete corpo[k]
      expect((await req('POST', '/api/emprestimos', 'admin', corpo)).statusCode).toBe(400)
    })
    it('indicador desativado é 400; cliente inexistente é 404', async () => {
      expect((await emprestar('admin', { indicadorId: id.ind2 })).statusCode).toBe(400)
      expect((await emprestar('admin', { clienteId: 999999 })).statusCode).toBe(404)
    })
    it('cria só juros: o cliente paga o juro todo mês e o capital volta na última parcela', async () => {
      const r = await emprestar('admin', { modalidade: 'JUROS', capital: 3000, taxa: 12, parcelas: 3 })
      expect(r.statusCode).toBe(201)
      const e = r.json()
      expect(e).toMatchObject({ modalidade: 'JUROS', capital: 3000, taxa: 12, nParcelas: 3, valorParcela: 360, total: 4080, lucroTotal: 1080, status: 'ATIVA' })
      expect(e.parcelas.map((p: { valor: number }) => p.valor)).toEqual([360, 360, 3360])
    })
    it('cria diária: capital + juros do período divididos em parcelas por dia útil', async () => {
      const r = await emprestar('admin', { modalidade: 'DIARIA', capital: 1000, taxa: 20, parcelas: 24 })
      expect(r.statusCode).toBe(201)
      const e = r.json()
      expect(e).toMatchObject({ modalidade: 'DIARIA', capital: 1000, taxa: 20, nParcelas: 24, valorParcela: 50, total: 1200, lucroTotal: 200 })
      expect(e.parcelas.every((p: { vencimento: string }) => new Date(p.vencimento + 'T12:00:00Z').getUTCDay() !== 0)).toBe(true)
    })
    it('modalidade inventada não cria nada', async () => {
      const antes = Number((await db!('emprestimos').count<{ count: string }[]>({ count: '*' }))[0].count)
      expect((await emprestar('admin', { modalidade: 'SEMANAL' })).statusCode).toBe(400)
      expect(Number((await db!('emprestimos').count<{ count: string }[]>({ count: '*' }))[0].count)).toBe(antes)
    })
    it('falha no meio não deixa empréstimo sem parcelas (tudo ou nada)', async () => {
      const antes = Number((await db!('emprestimos').count<{ count: string }[]>({ count: '*' }))[0].count)
      await db!.raw('alter table emprestimo_parcelas add constraint tmp_falha check (valor < 0) not valid')
      try { expect((await emprestar('admin')).statusCode).toBe(500) } finally { await db!.raw('alter table emprestimo_parcelas drop constraint tmp_falha') }
      expect(Number((await db!('emprestimos').count<{ count: string }[]>({ count: '*' }))[0].count)).toBe(antes)
    })
  })

  describe('ler e escopo', () => {
    it('o admin vê todos e o cobrador só os da carteira dele; o vendedor, 403 (o indicador lê só os dele: indicador-leitura.test.ts)', async () => {
      await emprestar('admin', { clienteId: id.cB })
      const adm = (await req('GET', '/api/emprestimos?limite=100', 'admin')).json()
      expect(new Set(adm.itens.map((x: { cliente: { nome: string } }) => x.cliente.nome))).toEqual(new Set(['Ana Souza', 'Bruno Lima']))
      const dele = (await req('GET', '/api/emprestimos?limite=100', 'cobrador')).json()
      expect(dele.itens.every((x: { cliente: { nome: string } }) => x.cliente.nome === 'Ana Souza')).toBe(true)
      expect((await req('GET', '/api/emprestimos', 'vendedor')).statusCode).toBe(403)
      expect((await req('GET', '/api/emprestimos/resumo', 'vendedor')).statusCode).toBe(403)
    })
    it('o cobrador não recebe capital, taxa, lucro nem indicador (os campos nem existem)', async () => {
      const lista = (await req('GET', '/api/emprestimos', 'cobrador')).json()
      const e = lista.itens[0]
      for (const campo of ['capital', 'taxa', 'lucroTotal', 'seuLucro', 'lucroRealizado', 'capitalDeVolta', 'percentualIndicador', 'parteIndicador', 'indicador']) expect(campo in e).toBe(false)
      expect(e.total).toBeGreaterThan(0)
      expect(JSON.stringify(lista)).not.toMatch(/capital|lucro|taxa/i)
    })
    it('ficha: do escopo abre; de outra carteira, inexistente e id inválido não', async () => {
      const bruno = (await req('GET', '/api/emprestimos?limite=100', 'admin')).json().itens.find((x: { cliente: { nome: string } }) => x.cliente.nome === 'Bruno Lima')
      expect((await req('GET', `/api/emprestimos/${bruno.id}`, 'admin')).statusCode).toBe(200)
      expect((await req('GET', `/api/emprestimos/${bruno.id}`, 'cobrador')).statusCode).toBe(404)
      expect((await req('GET', '/api/emprestimos/999999', 'admin')).statusCode).toBe(404)
      expect((await req('GET', '/api/emprestimos/abc', 'admin')).statusCode).toBe(400)
    })
    it('filtra por status e recusa status inventado; pagina', async () => {
      expect((await req('GET', '/api/emprestimos?status=QUITADA', 'admin')).json().itens).toHaveLength(0)
      expect((await req('GET', '/api/emprestimos?status=XYZ', 'admin')).statusCode).toBe(400)
      const p = (await req('GET', '/api/emprestimos?limite=2&pagina=1', 'admin')).json()
      expect(p.itens).toHaveLength(2)
      expect(p.total).toBeGreaterThan(2)
    })
    it('o resumo soma a receber, capital na rua e lucro por vir (cobrador vê só o a receber)', async () => {
      const r = (await req('GET', '/api/emprestimos/resumo', 'admin')).json()
      expect(r.aReceber).toBeGreaterThan(0)
      expect(r.capitalNaRua).toBeGreaterThan(0)
      expect(r.lucroPorVir).toBeGreaterThan(0)
      expect(Object.keys((await req('GET', '/api/emprestimos/resumo', 'cobrador')).json())).toEqual(['aReceber'])
    })
    it('mostra atraso: parcela vencida e não paga conta como atrasada', async () => {
      const e = (await emprestar('admin', { clienteId: id.cA })).json()
      await db!('emprestimo_parcelas').where({ emprestimo_id: e.id, numero: 1 }).update({ vencimento: '2026-09-01' })
      const de = (await req('GET', `/api/emprestimos/${e.id}`, 'admin')).json()
      expect(de.atrasadas).toBe(1)
      expect((await req('GET', '/api/emprestimos?status=ATRASO&limite=100', 'admin')).json().itens.some((x: { id: number }) => x.id === e.id)).toBe(true)
    })
  })
})
