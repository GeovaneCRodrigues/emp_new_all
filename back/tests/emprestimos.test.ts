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

describe('plano do empréstimo parcelado (puro)', () => {
  it('juros simples ao mês sobre o capital: 5.000 a 10% em 6x são 6 parcelas de 1.333,34', () => {
    const p = planoEmprestimo({ capital: 5000, modalidade: 'PARCELADO', taxa: 10, n: 6, data: '2026-06-25' })
    expect(p).toHaveLength(6)
    expect(p.every((x) => x.valor === 1333.34)).toBe(true)
    expect(p.map((x) => x.vencimento)).toEqual(['2026-07-25', '2026-08-25', '2026-09-25', '2026-10-25', '2026-11-25', '2026-12-25'])
  })
  it('arredonda a parcela para cima no centavo', () => {
    expect(planoEmprestimo({ capital: 1000, modalidade: 'PARCELADO', taxa: 7, n: 3, data: '2026-01-10' })[0].valor).toBe(403.34) // 1000 × 1,21 ÷ 3 = 403,333…
  })
  it('dia 31 cai no último dia dos meses curtos e volta a 31 depois', () => {
    const p = planoEmprestimo({ capital: 1000, modalidade: 'PARCELADO', taxa: 10, n: 3, data: '2026-01-31' })
    expect(p.map((x) => x.vencimento)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30'])
  })
  it('1 parcela só: capital + juros de um mês', () => {
    expect(planoEmprestimo({ capital: 2000, modalidade: 'PARCELADO', taxa: 8, n: 1, data: '2026-05-15' })).toEqual([{ vencimento: '2026-06-15', valor: 2160 }])
  })
})

describe('plano do empréstimo só juros (puro)', () => {
  it('3.000 a 12% em 3x: 360, 360 e 3.360 (capital na última)', () => {
    const p = planoEmprestimo({ capital: 3000, modalidade: 'JUROS', taxa: 12, n: 3, data: '2026-05-10' })
    expect(p.map((x) => x.valor)).toEqual([360, 360, 3360])
    expect(p.map((x) => x.vencimento)).toEqual(['2026-06-10', '2026-07-10', '2026-08-10'])
  })
  it('1 parcela só: juro mais capital de uma vez', () => {
    expect(planoEmprestimo({ capital: 1000, modalidade: 'JUROS', taxa: 5, n: 1, data: '2026-01-31' })).toEqual([{ vencimento: '2026-02-28', valor: 1050 }])
  })
  it('arredonda o juro ao centavo (sem acumular erro)', () => {
    const p = planoEmprestimo({ capital: 1234.56, modalidade: 'JUROS', taxa: 7.5, n: 2, data: '2026-01-10' })
    expect(p.map((x) => x.valor)).toEqual([92.59, 1327.15])
  })
})

describe.skipIf(!db)('empréstimos parcelados (Postgres de verdade)', () => {
  let app: FastifyInstance
  const hoje = '2026-10-08'
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}
  const req = (metodo: 'GET' | 'POST', url: string, papel?: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  const emprestar = (papel: string, corpo: object = {}) => req('POST', '/api/emprestimos', papel, { clienteId: id.cA, modalidade: 'PARCELADO', capital: 5000, taxa: 10, parcelas: 6, ...corpo })

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
      expect(e).toMatchObject({ cliente: { nome: 'Ana Souza' }, modalidade: 'PARCELADO', dataEmprestimo: hoje, capital: 5000, taxa: 10, nParcelas: 6, valorParcela: 1333.34, total: 8000.04, recebido: 0, falta: 8000.04, atrasadas: 0, status: 'ATIVA' })
      expect(e.lucroTotal).toBe(3000.04)
      expect(e.capitalDeVolta).toBe(0)
      expect(e.parcelas.map((p: { vencimento: string }) => p.vencimento)).toEqual(['2026-11-08', '2026-12-08', '2027-01-08', '2027-02-08', '2027-03-08', '2027-04-08'])
      const a = await db!('auditoria').where({ acao: 'EMPRESTIMO_CRIADO', entidade_id: e.id }).first()
      expect(a).toMatchObject({ usuario_id: id.admin })
    })
    it('ignora totais e parcelas mandados pela tela', async () => {
      const r = await emprestar('admin', { total: 1, valorParcela: 1, lucro: 99999, dataEmprestimo: '2020-01-01', parcelasCalculadas: [] })
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
      ['taxa zero', { taxa: 0 }], ['taxa acima de 100', { taxa: 101 }], ['taxa como texto', { taxa: '10' }],
      ['zero parcelas', { parcelas: 0 }], ['parcelas quebradas', { parcelas: 2.5 }], ['parcelas demais', { parcelas: 61 }], ['sem parcelas', { parcelas: undefined }],
      ['observações enormes', { observacoes: 'x'.repeat(501) }], 
    ])('recusa %s (400)', async (_n, m) => {
      const corpo = { clienteId: id.cA, modalidade: 'PARCELADO', capital: 5000, taxa: 10, parcelas: 6, ...m } as Record<string, unknown>
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
    it('DIARIA ainda não está liberada (400), sem criar nada', async () => {
      const antes = Number((await db!('emprestimos').count<{ count: string }[]>({ count: '*' }))[0].count)
      for (const modalidade of ['DIARIA']) expect((await emprestar('admin', { modalidade })).statusCode).toBe(400)
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
    it('o admin vê todos e o cobrador só os da carteira dele; vendedor e indicador, 403', async () => {
      await emprestar('admin', { clienteId: id.cB })
      const adm = (await req('GET', '/api/emprestimos?limite=100', 'admin')).json()
      expect(new Set(adm.itens.map((x: { cliente: { nome: string } }) => x.cliente.nome))).toEqual(new Set(['Ana Souza', 'Bruno Lima']))
      const dele = (await req('GET', '/api/emprestimos?limite=100', 'cobrador')).json()
      expect(dele.itens.every((x: { cliente: { nome: string } }) => x.cliente.nome === 'Ana Souza')).toBe(true)
      for (const papel of ['vendedor', 'indicador']) {
        expect((await req('GET', '/api/emprestimos', papel)).statusCode).toBe(403)
        expect((await req('GET', '/api/emprestimos/resumo', papel)).statusCode).toBe(403)
      }
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
