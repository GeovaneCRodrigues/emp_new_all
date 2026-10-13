import type { FastifyInstance } from 'fastify'
import type { Knex } from 'knex'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { createAuditoriaRepository } from '../src/modules/auditoria/models/repository.js'
import { createSessoesRepository, createUsuariosRepository } from '../src/modules/auth/models/repository.js'
import { createAuthService } from '../src/modules/auth/services/auth.service.js'
import { hashSenha } from '../src/modules/auth/services/password.js'
import { createTokensService } from '../src/modules/auth/services/tokens.js'
import { createCaixaRepository } from '../src/modules/caixa/models/repository.js'
import { createCaixaService } from '../src/modules/caixa/services/caixa.service.js'
import { createConfigRepository } from '../src/modules/config/models/repository.js'
import { createConfigService } from '../src/modules/config/services/config.service.js'
import { createEmprestimosRepository } from '../src/modules/emprestimos/models/repository.js'
import { createEmprestimosService } from '../src/modules/emprestimos/services/emprestimos.service.js'
import { createIndicadoresRepository } from '../src/modules/indicadores/models/repository.js'
import { createIndicadoresService } from '../src/modules/indicadores/services/indicadores.service.js'
import { createVendasRepository } from '../src/modules/vendas/models/repository.js'
import { createVendasService } from '../src/modules/vendas/services/vendas.service.js'
import { termoBusca } from '../src/shared/busca.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()
const SENHA = 'senha-forte-123'
const HOJE = '2026-10-08'

describe('termoBusca (puro)', () => {
  it('tira acento, maiúscula e espaço sobrando', () => {
    expect(termoBusca('  JOÃO   da  Conceição ')).toBe('joao da conceicao')
  })
  it('vazio, só espaço e o que não é texto viram "sem busca"', () => {
    for (const v of ['', '   ', undefined, null, 42, ['a'], {}]) expect(termoBusca(v)).toBeUndefined()
  })
  it('corta em 80 letras', () => {
    expect(termoBusca('a'.repeat(300))).toHaveLength(80)
  })
})

describe.skipIf(!db)('busca nas listas (Postgres de verdade)', () => {
  let app: FastifyInstance
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}
  const req = (url: string, papel = 'admin') => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${t[papel]}` } })
  const nomes = async (url: string, papel = 'admin') => ((await req(url, papel)).json().itens as { cliente?: { nome: string } }[]).map((i) => i.cliente?.nome)

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    const hash = await hashSenha(SENHA)
    const [ind] = await k('indicadores').insert({ nome: 'Roberto Indicador', pct: 0.5, pct_manual: true }).returning('id')
    id.ind = ind.id
    for (const [chave, perfil, extra] of [['admin', 'ADMIN', {}], ['vendedor', 'VENDEDOR', {}], ['outro', 'VENDEDOR', {}], ['indicador', 'INDICADOR', { indicador_id: ind.id }]] as const) {
      id[chave] = (await k('users').insert({ nome: chave, email: `${chave}@t.com`, senha_hash: hash, perfil, ...extra }).returning('id'))[0].id
    }
    const cli = async (chave: string, nome: string, resp: number | null) => { id[chave] = (await k('clientes').insert({ nome, fone: '11900000000', responsavel_id: resp }).returning('id'))[0].id }
    await cli('joao', 'JOÃO DA CONCEIÇÃO', id.vendedor)
    await cli('maria', 'MARIA SILVA', id.vendedor)
    await cli('pedro', 'PEDRO 100% SÉRIO', id.outro)

    const bem = async (modelo: string, gb: number, cor: string, imei: string) => (await k('bens').insert({ modelo, gb, cor, imei, preco_venda: 5000, valor_compra: 3000, custos_extras: 0, data_compra: '2026-09-01', estado: 'VENDIDO' }).returning('id'))[0].id
    const venda = async (cliente: string, bemId: number, indicadorId: number | null = null) => {
      const [v] = await k('vendas').insert({ bem_id: bemId, cliente_id: id[cliente], vendedor_id: cliente === 'pedro' ? id.outro : id.vendedor, indicador_id: indicadorId, percentual_indicador: indicadorId ? 0.5 : 0, data_venda: '2026-10-01', preco_acordado: 5000, entrada: 0, troca_valor: 0, juros_pct: 0, valor_investido: 3000, valor_total: 5000, status: 'ATIVA' }).returning('id')
      await k('venda_parcelas').insert({ venda_id: v.id, numero: 1, vencimento: '2026-11-01', valor: 5000 })
    }
    await venda('joao', await bem('IPHONE 15 PRO', 256, 'AZUL', '350000000000001'))
    await venda('maria', await bem('IPHONE 13', 128, 'PRETO', '350000000000002'), id.ind)
    await venda('pedro', await bem('IPHONE 17 PRO MAX', 512, 'LARANJA', '350000000000003'))

    const emp = async (cliente: string, indicadorId: number | null = null) => {
      const [e] = await k('emprestimos').insert({ cliente_id: id[cliente], indicador_id: indicadorId, percentual_indicador: indicadorId ? 0.5 : 0, data_emprestimo: '2026-10-01', capital: 1000, modalidade: 'PARCELADO', periodicidade: 'MENSAL', taxa: 30, status: 'ATIVA', modo_divisao: 'CAPITAL_PRIMEIRO' }).returning('id')
      await k('emprestimo_parcelas').insert({ emprestimo_id: e.id, numero: 1, vencimento: '2026-11-01', valor: 1300 })
    }
    await emp('joao'); await emp('maria', id.ind); await emp('pedro')

    // caixa: um recibo cobrado pela loja e uma despesa manual
    const [tr] = await k('transacoes_recebimento').insert({ numero_recibo: 1, cliente_id: id.joao, valor_total: 100, forma_pagamento: 'PIX', data_recebimento: '2026-10-05', resumo: JSON.stringify({ referencia: 'parcela 1/4' }) }).returning('id')
    await k('recebimentos').insert({ transacao_id: tr.id, tipo: 'PARCELA', emprestimo_parcela_id: (await k('emprestimo_parcelas').first('id')).id, valor: 100 })
    await k('movimentacoes_caixa').insert([{ tipo: 'APORTE', valor: 50000, data: '2026-10-01', obs: null }, { tipo: 'DESPESA', valor: 80, data: '2026-10-06', obs: 'Conta de luz da loja' }])

    const tokens = createTokensService('x'.repeat(40), '15m')
    const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
    const audit = createAuditoriaRepository(k)
    const indicadores = createIndicadoresService(createIndicadoresRepository(k), audit)
    const config = createConfigRepository(k)
    app = await buildApp({
      env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, clientes: {} as never, usuarios: {} as never, indicadores, estoque: {} as never,
      vendas: createVendasService({ vendas: createVendasRepository(k), config, auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis(), hoje: () => HOJE }),
      emprestimos: createEmprestimosService({ emprestimos: createEmprestimosRepository(k), auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis(), hoje: () => HOJE }),
      config: createConfigService(config), recebimentos: {} as never, aprovacoes: {} as never, fechamentos: {} as never, equipe: {} as never,
      caixa: createCaixaService({ repo: createCaixaRepository(k), auditoria: audit, hoje: () => HOJE }),
      limites: { vendasPorMinuto: 100_000, recebimentosPorMinuto: 100_000 },
    })
    for (const papel of ['admin', 'vendedor', 'outro', 'indicador']) t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  })
  afterAll(async () => { await app?.close(); await db?.destroy() })

  describe.each([['vendas', '/api/vendas'], ['empréstimos', '/api/emprestimos']])('%s', (_n, base) => {
    it('sem busca (ou busca vazia) traz tudo', async () => {
      expect(await nomes(base)).toHaveLength(3)
      expect(await nomes(`${base}?busca=`)).toHaveLength(3)
      expect(await nomes(`${base}?busca=%20%20`)).toHaveLength(3)
    })
    it('acha pelo nome do cliente, sem acento nem maiúscula', async () => {
      expect(await nomes(`${base}?busca=joao`)).toEqual(['JOÃO DA CONCEIÇÃO'])
      expect(await nomes(`${base}?busca=JOÃO`)).toEqual(['JOÃO DA CONCEIÇÃO'])
      expect(await nomes(`${base}?busca=conceicao`)).toEqual(['JOÃO DA CONCEIÇÃO'])
      expect(await nomes(`${base}?busca=serio`)).toEqual(['PEDRO 100% SÉRIO'])
    })
    it('várias palavras, em qualquer ordem e com palavras no meio faltando', async () => {
      expect(await nomes(`${base}?busca=${encodeURIComponent('conceicao joao')}`)).toEqual(['JOÃO DA CONCEIÇÃO'])
      expect(await nomes(`${base}?busca=${encodeURIComponent('joao conceicao')}`)).toEqual(['JOÃO DA CONCEIÇÃO'])
      expect(await nomes(`${base}?busca=${encodeURIComponent('joao silva')}`)).toEqual([]) // todas as palavras têm de aparecer
    })
    it('acha pelo nome do indicador', async () => {
      expect(await nomes(`${base}?busca=roberto`)).toEqual(['MARIA SILVA'])
    })
    it('% e _ valem como letra, não como curinga', async () => {
      expect(await nomes(`${base}?busca=${encodeURIComponent('100%')}`)).toEqual(['PEDRO 100% SÉRIO'])
      expect(await nomes(`${base}?busca=%25`)).toEqual(['PEDRO 100% SÉRIO'])
      expect(await nomes(`${base}?busca=_`)).toEqual([])
    })
    it('aspas e SQL no texto não quebram nem passam', async () => {
      const r = await req(`${base}?busca=${encodeURIComponent("'; drop table clientes; --")}`)
      expect(r.statusCode).toBe(200)
      expect(r.json().itens).toEqual([])
      expect(await db!('clientes').count('* as n').first()).toMatchObject({ n: '3' })
    })
    it('combina com o filtro de status e o total acompanha a busca', async () => {
      const r = (await req(`${base}?busca=maria&status=ATIVA`)).json()
      expect(r.total).toBe(1)
      expect((await req(`${base}?busca=maria&status=QUITADA`)).json().total).toBe(0)
    })
    it('a busca respeita o escopo: o indicador só acha o que é dele', async () => {
      expect(await nomes(`${base}?busca=joao`, 'indicador')).toEqual([])
      expect(await nomes(`${base}?busca=maria`, 'indicador')).toEqual(['MARIA SILVA'])
    })
  })

  describe('vendas: também pelo aparelho', () => {
    const aparelhos = async (q: string, papel = 'admin') => ((await req(`/api/vendas?busca=${encodeURIComponent(q)}`, papel)).json().itens as { aparelho: { modelo: string } }[]).map((i) => i.aparelho.modelo)
    it('modelo, cor, capacidade e IMEI', async () => {
      expect(await aparelhos('17 pro max')).toEqual(['IPHONE 17 PRO MAX'])
      expect(await aparelhos('azul')).toEqual(['IPHONE 15 PRO'])
      expect(await aparelhos('128 gb')).toEqual(['IPHONE 13'])
      expect(await aparelhos('350000000000002')).toEqual(['IPHONE 13'])
    })
    it('o vendedor só acha as vendas da carteira dele', async () => {
      expect(await aparelhos('17 pro max', 'vendedor')).toEqual([])
      expect(await aparelhos('iphone 13', 'vendedor')).toEqual(['IPHONE 13'])
    })
    it('o IMEI não aparece na resposta (só serve para achar)', async () => {
      expect(JSON.stringify((await req('/api/vendas?busca=350000000000002')).json())).not.toContain('350000000000002')
    })
  })

  describe('extrato do caixa', () => {
    const titulos = async (q: string) => ((await req(`/api/caixa?busca=${encodeURIComponent(q)}`)).json() as { itens: { titulo: string; sub: string }[]; total: number })
    it('acha pelo cliente, pela descrição do lançamento e pelo detalhe', async () => {
      expect((await titulos('conceicao')).itens.map((i) => i.titulo).sort()).toEqual(['Empréstimo liberado · JOÃO DA CONCEIÇÃO', 'JOÃO DA CONCEIÇÃO'])
      expect((await titulos('luz')).itens).toHaveLength(1)
      expect((await titulos('pix')).total).toBe(1)
    })
    it('o total e o saldo não mudam com a busca (a busca só filtra o extrato)', async () => {
      const todos = (await req('/api/caixa')).json()
      const achou = await titulos('luz') as unknown as { saldo: number; total: number }
      expect(achou.saldo).toBe(todos.saldo)
      expect(achou.total).toBeLessThan(todos.total)
    })
    it('só o administrador', async () => {
      expect((await req('/api/caixa?busca=luz', 'vendedor')).statusCode).toBe(403)
    })
  })
})
