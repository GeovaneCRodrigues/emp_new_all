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
import { createEstoqueRepository } from '../src/modules/estoque/models/repository.js'
import { createEstoqueService } from '../src/modules/estoque/services/estoque.service.js'
import { createIndicadoresRepository } from '../src/modules/indicadores/models/repository.js'
import { createIndicadoresService } from '../src/modules/indicadores/services/indicadores.service.js'
import { createVendasRepository } from '../src/modules/vendas/models/repository.js'
import { createVendasService } from '../src/modules/vendas/services/vendas.service.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()
const SENHA = 'senha-forte-123'

describe.skipIf(!db)('vendas (Postgres de verdade)', () => {
  let app: FastifyInstance
  let hoje = '2026-10-08'
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}

  const req = (metodo: 'GET' | 'POST' | 'PATCH', url: string, papel?: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })

  /** Cria um aparelho disponível direto no banco e devolve o id. */
  async function aparelho(preco = 7500, custo = 5000, extras = 0, extra: object = {}): Promise<number> {
    const [b] = await db!('bens').insert({ modelo: 'iPhone 16', gb: 128, cor: 'Preto', preco_venda: preco, valor_compra: custo, custos_extras: extras, data_compra: '2026-09-01', ...extra }).returning('id')
    return b.id
  }
  const vender = async (papel: string, corpo: object) => req('POST', '/api/vendas', papel, corpo)
  /** Venda padrão do plano: 7.500, entrada 1.500, 10x, dia 10. */
  const corpoBase = async (extra: object = {}) => ({ aparelhoId: await aparelho(), clienteId: id.cA, preco: 7500, entrada: 1500, parcelas: 10, diaVencimento: 10, ...extra })

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    await k('sistema_config').where({ chave: 'juros_parcela_pct' }).update({ valor: JSON.stringify(10) })
    await k('sistema_config').where({ chave: 'max_parcelas' }).update({ valor: JSON.stringify(10) })
    const hash = await hashSenha(SENHA)
    const [i1, i2] = await k('indicadores').insert([{ nome: 'Roberto', pct: 0.5, pct_manual: true }, { nome: 'Loja Auto', pct: 0.3, pct_manual: false }]).returning('id')
    id.ind1 = i1.id; id.ind2 = i2.id
    for (const [chave, perfil, extra] of [['admin', 'ADMIN', {}], ['vendedorA', 'VENDEDOR', {}], ['vendedorB', 'VENDEDOR', {}], ['cobrador', 'COBRADOR', {}], ['indicador', 'INDICADOR', { indicador_id: i1.id }]] as const) {
      const [u] = await k('users').insert({ nome: chave, email: `${chave}@t.com`, senha_hash: hash, perfil, ...extra }).returning('id')
      id[chave] = u.id
    }
    const cli = async (chave: string, nome: string, resp: number | null) => { const [c] = await k('clientes').insert({ nome, fone: '11900000000', responsavel_id: resp }).returning('id'); id[chave] = c.id }
    await cli('cA', 'Ana da Carteira A', id.vendedorA)
    await cli('cB', 'Bruno da Carteira B', id.vendedorB)
    await cli('cC', 'Carla do Cobrador', id.cobrador)
    await cli('cSem', 'Sem Responsável', null)

    const tokens = createTokensService('x'.repeat(40), '15m')
    const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
    const audit = createAuditoriaRepository(k)
    const indicadores = createIndicadoresService(createIndicadoresRepository(k), audit)
    const config = createConfigRepository(k)
    app = await buildApp({
      env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth,
      clientes: {} as never, usuarios: {} as never, indicadores, estoque: createEstoqueService(createEstoqueRepository(k), audit),
      vendas: createVendasService({ vendas: createVendasRepository(k), config, auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis(), hoje: () => hoje }),
      config: createConfigService(config), limites: { vendasPorMinuto: 100_000 },
    })
    for (const papel of ['admin', 'vendedorA', 'vendedorB', 'cobrador', 'indicador'])
      t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  })

  beforeEach(() => { hoje = '2026-10-08' })
  afterAll(async () => {
    await db?.('sistema_config').where({ chave: 'juros_parcela_pct' }).update({ valor: JSON.stringify(10) })
    await app?.close()
    await db?.destroy()
  })

  describe('permissões', () => {
    it('cobrador e indicador não vendem (403); sem login, 401', async () => {
      for (const papel of ['cobrador', 'indicador']) expect((await vender(papel, await corpoBase())).statusCode).toBe(403)
      expect((await req('POST', '/api/vendas', undefined, await corpoBase())).statusCode).toBe(401)
    })
    it('o indicador não vê vendas (a área dele vem depois); o cobrador vê só a carteira', async () => {
      expect((await req('GET', '/api/vendas', 'indicador')).statusCode).toBe(403)
      expect((await req('GET', '/api/vendas/resumo', 'indicador')).statusCode).toBe(403)
    })
  })

  describe('as contas do plano (o servidor refaz tudo)', () => {
    it('7.500 com 1.500 de entrada em 10x: 10 parcelas de 1.200, vencendo dia 10 a partir do mês seguinte', async () => {
      const r = await vender('admin', await corpoBase({ clienteId: id.cA }))
      expect(r.statusCode).toBe(201)
      const v = r.json()
      expect(v).toMatchObject({ nParcelas: 10, valorParcela: 1200, total: 13500, recebido: 1500, falta: 12000, status: 'ATIVA', contrato: 'AGUARDANDO', precoAcordado: 7500, entrada: 1500, jurosPct: 10, dataVenda: '2026-10-08' })
      expect(v.parcelas[0]).toMatchObject({ numero: 1, vencimento: '2026-11-10', valor: 1200, pago: 0, falta: 1200 })
      expect(v.parcelas[9].vencimento).toBe('2027-08-10')
    })
    it.each([[6, 1600], [5, 1800]])('%ix → parcelas de %d', async (n, parc) => {
      const v = (await vender('admin', await corpoBase({ parcelas: n }))).json()
      expect(v.valorParcela).toBe(parc)
      expect(v.total).toBe(1500 + parc * n)
    })
    it('o servidor ignora total e parcela mandados pela tela', async () => {
      const v = (await vender('admin', await corpoBase({ total: 1, valorParcela: 1, parcelado: 1, jurosPct: 0, juros: 0, percentualIndicador: 1, investido: 1, status: 'QUITADA' }))).json()
      expect(v).toMatchObject({ valorParcela: 1200, total: 13500, jurosPct: 10, status: 'ATIVA' })
    })
    it('arredonda a parcela para cima no centavo (e o cliente paga parcela × n)', async () => {
      const v = (await vender('admin', await corpoBase({ preco: 2000, entrada: 1000, parcelas: 3 }))).json()
      expect(v.valorParcela).toBe(433.34) // 1.000 × 1,3 ÷ 3
      expect(v.total).toBe(2300.02)
    })
    it('dia 31 cai no último dia dos meses curtos', async () => {
      hoje = '2026-01-20'
      const v = (await vender('admin', await corpoBase({ parcelas: 3, diaVencimento: 31 }))).json()
      expect(v.parcelas.map((p: { vencimento: string }) => p.vencimento)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30'])
    })
    it('a taxa vem da configuração, fica gravada na venda, e mudar depois não altera as antigas', async () => {
      const antiga = (await vender('admin', await corpoBase())).json()
      await db!('sistema_config').where({ chave: 'juros_parcela_pct' }).update({ valor: JSON.stringify(5) })
      try {
        const nova = (await vender('admin', await corpoBase({ parcelas: 4, entrada: 1500 }))).json()
        expect(nova).toMatchObject({ jurosPct: 5, valorParcela: 1800 }) // 6.000 × 1,2 ÷ 4
        expect((await req('GET', `/api/vendas/${antiga.id}`, 'admin')).json()).toMatchObject({ jurosPct: 10, valorParcela: 1200 })
      } finally {
        await db!('sistema_config').where({ chave: 'juros_parcela_pct' }).update({ valor: JSON.stringify(10) })
      }
    })
    it('à vista: entrada + troca = preço fecha a venda quitada, sem parcelas', async () => {
      const v = (await vender('admin', await corpoBase({ entrada: 7500, parcelas: undefined, diaVencimento: undefined }))).json()
      expect(v).toMatchObject({ nParcelas: 0, status: 'QUITADA', falta: 0, total: 7500 })
    })
  })

  describe('lucro e indicador (só o admin vê)', () => {
    it('sem indicador: lucro total 8.500, tudo do dono; o custo do dia fica gravado', async () => {
      const v = (await vender('admin', await corpoBase({ aparelhoId: await aparelho(7500, 4800, 200) }))).json()
      expect(v).toMatchObject({ custoNoDia: 5000, lucroTotal: 8500, seuLucro: 8500, percentualIndicador: 0, parteIndicador: 0, indicador: null })
    })
    it('com indicador de 50%: o lucro se divide meio a meio e o % fica congelado', async () => {
      const v = (await vender('admin', await corpoBase({ indicadorId: id.ind1 }))).json()
      expect(v).toMatchObject({ percentualIndicador: 0.5, parteIndicador: 4250, seuLucro: 4250, indicador: { nome: 'Roberto' } })
      await db!('indicadores').where({ id: id.ind1 }).update({ pct: 0.2 })
      try {
        expect((await req('GET', `/api/vendas/${v.id}`, 'admin')).json()).toMatchObject({ percentualIndicador: 0.5, seuLucro: 4250 })
      } finally {
        await db!('indicadores').where({ id: id.ind1 }).update({ pct: 0.5 })
      }
    })
    it('corrigir o custo do aparelho depois não muda o lucro da venda', async () => {
      const apId = await aparelho(7500, 5000)
      const v = (await vender('admin', await corpoBase({ aparelhoId: apId }))).json()
      await db!('bens').where({ id: apId }).update({ valor_compra: 1 })
      expect((await req('GET', `/api/vendas/${v.id}`, 'admin')).json()).toMatchObject({ custoNoDia: 5000, lucroTotal: 8500 })
    })
    it('o dinheiro que entra primeiro devolve o capital; só o resto é lucro', async () => {
      const v = (await vender('admin', await corpoBase({ entrada: 5000, parcelas: 2, indicadorId: id.ind1 }))).json()
      // preço 7.500, entrada 5.000: já voltou o capital (5.000) sem lucro realizado
      expect(v).toMatchObject({ capitalDeVolta: 5000, lucroRealizado: 0 })
    })
    it('indicador desativado ou inexistente é recusado', async () => {
      expect((await vender('admin', await corpoBase({ indicadorId: 99999 }))).statusCode).toBe(400)
      const [off] = await db!('indicadores').insert({ nome: 'Inativo', pct: 0.4, ativo: false }).returning('id')
      expect((await vender('admin', await corpoBase({ indicadorId: off.id }))).statusCode).toBe(400)
    })
    it('depois da venda, o contador de operações do indicador anda e o nível automático acompanha', async () => {
      // Loja Auto (automática, 30% Bronze): com 3 operações vira Prata (40%)
      for (let i = 0; i < 3; i++) expect((await vender('admin', await corpoBase({ indicadorId: id.ind2 }))).statusCode).toBe(201)
      const [ind] = await db!('indicadores').where({ id: id.ind2 })
      expect(Number(ind.pct)).toBe(0.4)
      // as vendas antigas ficaram com o % de quando foram feitas (30%, 30%, 30%) e a 3ª com 30% também
      const pcts = (await db!('vendas').where({ indicador_id: id.ind2 }).orderBy('id')).map((x: { percentual_indicador: string }) => Number(x.percentual_indicador))
      expect(pcts).toEqual([0.3, 0.3, 0.3])
    })
  })

  describe('troca', () => {
    const troca = (extra: object = {}) => ({ modelo: 'iPhone 11', gb: 64, cor: 'Preto', bateria: 82, valor: 900, ...extra })
    it('o aparelho da troca entra no estoque custando o que foi aceito, e abate o parcelado', async () => {
      const v = (await vender('admin', await corpoBase({ troca: troca(), parcelas: 5 }))).json()
      // parcelado = 7.500 − 1.500 − 900 = 5.100 → 5.100 × 1,5 ÷ 5 = 1.530
      expect(v).toMatchObject({ troca: 900, valorParcela: 1530, total: 1500 + 900 + 1530 * 5 })
      const [b] = await db!('bens').where({ modelo: 'iPhone 11', origem: 'TROCA' }).orderBy('id', 'desc')
      expect(b).toMatchObject({ estado: 'DISPONIVEL', origem: 'TROCA', bateria: 82 })
      expect(Number(b.valor_compra)).toBe(900)
      expect(Number(b.preco_venda)).toBe(1125) // custo + 25% por padrão
    })
    it('preço de revenda informado vale', async () => {
      await vender('admin', await corpoBase({ troca: troca({ modelo: 'iPhone 11 Revenda', precoRevenda: 1500 }) }))
      expect(Number((await db!('bens').where({ modelo: 'iPhone 11 Revenda' }).first()).preco_venda)).toBe(1500)
    })
    it('IMEI da troca repetido desfaz TUDO: o aparelho continua disponível e nenhuma venda nasce', async () => {
      await db!('bens').insert({ modelo: 'Outro', gb: 64, cor: 'Azul', preco_venda: 100, data_compra: '2026-01-01', imei: '490154203237518' })
      const apId = await aparelho()
      const antes = Number((await db!('vendas').count<{ count: string }[]>({ count: '*' }))[0].count)
      const r = await vender('admin', await corpoBase({ aparelhoId: apId, troca: troca({ modelo: 'iPhone 11 Dup', imei: '490154203237518' }) }))
      expect(r.statusCode).toBe(409)
      expect((await db!('bens').where({ id: apId }).first()).estado).toBe('DISPONIVEL')
      expect(Number((await db!('vendas').count<{ count: string }[]>({ count: '*' }))[0].count)).toBe(antes)
      expect(await db!('bens').where({ modelo: 'iPhone 11 Dup' })).toHaveLength(0)
    })
    it.each([['sem modelo', { modelo: '' }], ['bateria inválida', { bateria: 150 }], ['valor zero', { valor: 0 }], ['IMEI inválido', { imei: '123' }]])('recusa troca %s (400)', async (_n, m) => {
      expect((await vender('admin', await corpoBase({ troca: troca(m) }))).statusCode).toBe(400)
    })
  })

  describe('entrada vira recebimento', () => {
    it('registra a entrada com forma, quem recebeu e número de recibo', async () => {
      const v = (await vender('vendedorA', await corpoBase({ formaEntrada: 'DINHEIRO' }))).json()
      const r = await db!('recebimentos as r').join('transacoes_recebimento as t', 't.id', 'r.transacao_id').where('r.venda_id', v.id).first()
      expect(r).toMatchObject({ tipo: 'ENTRADA', forma_pagamento: 'DINHEIRO', recebido_por: id.vendedorA, cliente_id: id.cA })
      expect(Number(r.valor)).toBe(1500)
      expect(r.numero_recibo).toBeGreaterThan(0)
    })
    it('sem entrada não cria recebimento', async () => {
      const v = (await vender('admin', await corpoBase({ entrada: 0, parcelas: 10 }))).json()
      expect(await db!('recebimentos').where({ venda_id: v.id })).toHaveLength(0)
    })
  })

  describe('validações (400)', () => {
    it.each([
      ['sem aparelho', { aparelhoId: undefined }], ['sem cliente', { clienteId: undefined }], ['entrada negativa', { entrada: -1 }],
      ['entrada + troca acima do preço', { entrada: 8000 }], ['mais parcelas que o máximo', { parcelas: 11 }], ['sem parcelas mas sobra a pagar', { parcelas: 0 }],
      ['parcelas com valor quebrado', { parcelas: 2.5 }], ['sem dia de vencimento', { diaVencimento: undefined }], ['dia 0', { diaVencimento: 0 }], ['dia 32', { diaVencimento: 32 }],
      ['forma de pagamento inventada', { formaEntrada: 'FIADO' }], ['preço zero', { preco: 0 }], ['preço como texto', { preco: '7500' }],
      ['parcelas quando não sobra nada', { entrada: 7500, parcelas: 3 }],
    ])('recusa %s', async (_n, mudanca) => {
      const corpo = { ...(await corpoBase()), ...mudanca } as Record<string, unknown>
      for (const k of Object.keys(corpo)) if (corpo[k] === undefined) delete corpo[k]
      const r = await vender('admin', corpo)
      expect(r.statusCode).toBe(400)
    })
    it('aparelho inexistente é 404 e cliente inexistente é 404', async () => {
      expect((await vender('admin', await corpoBase({ aparelhoId: 999999 }))).statusCode).toBe(404)
      expect((await vender('admin', await corpoBase({ clienteId: 999999 }))).statusCode).toBe(404)
    })
  })

  describe('aparelho disponível, encomendado, vendido', () => {
    it('aparelho já vendido é 409', async () => {
      const corpo = await corpoBase()
      expect((await vender('admin', corpo)).statusCode).toBe(201)
      const r = await vender('admin', corpo)
      expect(r.statusCode).toBe(409)
      expect(r.json().codigo).toBe('APARELHO_INDISPONIVEL')
    })
    it('aparelho marcado como vendido no estoque (sem venda ativa) também é recusado: a checagem do estado vale sozinha', async () => {
      const apId = await aparelho(7500, 5000, 0, { estado: 'VENDIDO' })
      expect((await vender('admin', await corpoBase({ aparelhoId: apId }))).statusCode).toBe(409)
      expect(await db!('vendas').where({ bem_id: apId })).toHaveLength(0)
    })
    it('encomendado só vende para quem encomendou (e limpa a encomenda)', async () => {
      const apId = await aparelho(7500, 5000, 0, { estado: 'ENCOMENDADO', cliente_encomenda_id: id.cC })
      const errado = await vender('admin', await corpoBase({ aparelhoId: apId, clienteId: id.cA }))
      expect(errado.statusCode).toBe(409)
      expect(errado.json().codigo).toBe('APARELHO_ENCOMENDADO')
      expect((await vender('admin', await corpoBase({ aparelhoId: apId, clienteId: id.cC }))).statusCode).toBe(201)
      expect(await db!('bens').where({ id: apId }).first()).toMatchObject({ estado: 'VENDIDO', cliente_encomenda_id: null })
    })
    it('o banco impede duas vendas ativas do mesmo aparelho', async () => {
      const apId = await aparelho()
      await vender('admin', await corpoBase({ aparelhoId: apId }))
      await expect(db!('vendas').insert({ bem_id: apId, cliente_id: id.cA, data_venda: '2026-10-08', valor_investido: 1, valor_total: 1 })).rejects.toThrow()
    })
    it('CORRIDA: duas vendas do mesmo aparelho ao mesmo tempo → uma passa (201) e a outra recebe 409', async () => {
      const apId = await aparelho()
      const corpo = await corpoBase({ aparelhoId: apId })
      const [a, b] = await Promise.all([vender('admin', corpo), vender('admin', { ...corpo, clienteId: id.cB })])
      expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409])
      expect(await db!('vendas').where({ bem_id: apId })).toHaveLength(1)
      expect(await db!('venda_parcelas').whereIn('venda_id', db!('vendas').where({ bem_id: apId }).select('id'))).toHaveLength(10) // sem parcelas duplicadas
    })
  })

  describe('vendedor', () => {
    it('vende para cliente da carteira dele e fica registrado como vendedor da venda', async () => {
      const v = (await vender('vendedorA', await corpoBase({ clienteId: id.cA }))).json()
      expect((await db!('vendas').where({ id: v.id }).first()).vendedor_id).toBe(id.vendedorA)
    })
    it('cliente de outro vendedor ou sem responsável não aparece (404)', async () => {
      for (const c of [id.cB, id.cSem]) expect((await vender('vendedorA', await corpoBase({ clienteId: c }))).statusCode).toBe(404)
    })
    it('não vende abaixo do preço de tabela, mas pode vender acima', async () => {
      expect((await vender('vendedorA', await corpoBase({ preco: 7000 }))).statusCode).toBe(403)
      expect((await vender('vendedorA', await corpoBase({ preco: 8000 }))).statusCode).toBe(201)
      expect((await vender('admin', await corpoBase({ preco: 7000 }))).statusCode).toBe(201) // o admin é livre
    })
    it('não vende em nome de outro; o admin pode escolher o vendedor (válido)', async () => {
      expect((await vender('vendedorA', await corpoBase({ vendedorId: id.vendedorB }))).statusCode).toBe(403)
      expect((await vender('admin', await corpoBase({ vendedorId: id.cobrador }))).statusCode).toBe(400)
      expect((await vender('admin', await corpoBase({ vendedorId: id.vendedorB }))).statusCode).toBe(201)
    })
    it('NUNCA recebe custo, lucro nem a parte do indicador: os campos nem existem', async () => {
      const v = await vender('vendedorA', await corpoBase({ clienteId: id.cA, indicadorId: id.ind1 }))
      const venda = v.json()
      expect(v.body).not.toMatch(/custoNoDia|lucro|seuLucro|parteIndicador|percentualIndicador|capitalDeVolta|investido/i)
      for (const url of ['/api/vendas?limite=100', `/api/vendas/${venda.id}`, '/api/vendas/resumo'])
        expect((await req('GET', url, 'vendedorA')).body).not.toMatch(/custoNoDia|lucro|seuLucro|parteIndicador|percentualIndicador|capitalDeVolta|capitalNaRua|investido/i)
      expect(venda.total).toBeGreaterThan(0) // mas vê o que o cliente paga
    })
  })

  describe('lista, ficha e resumo', () => {
    beforeAll(async () => {
      // uma venda na carteira de cada um, para o escopo ter o que separar
      for (const clienteId of [id.cA, id.cB, id.cC]) expect((await vender('admin', await corpoBase({ clienteId }))).statusCode).toBe(201)
    })
    it('cada perfil só vê as vendas do seu escopo', async () => {
      const nomes = async (papel: string) => ((await req('GET', '/api/vendas?limite=100', papel)).json().itens as { cliente: { nome: string } }[]).map((x) => x.cliente.nome)
      expect(new Set(await nomes('admin'))).toEqual(new Set(['Ana da Carteira A', 'Bruno da Carteira B', 'Carla do Cobrador']))
      // cada um vê os clientes da carteira dele (e o vendedor, também o que o admin vendeu em nome dele)
      expect((await nomes('vendedorA')).every((n) => n === 'Ana da Carteira A')).toBe(true)
      expect((await nomes('vendedorB')).every((n) => n === 'Bruno da Carteira B' || n === 'Ana da Carteira A')).toBe(true) // a Ana: venda atribuída a ele pelo admin
      expect(await nomes('vendedorB')).toContain('Bruno da Carteira B')
      expect(await nomes('vendedorA')).not.toContain('Bruno da Carteira B')
      expect(await nomes('vendedorA')).not.toContain('Carla do Cobrador')
      expect((await nomes('cobrador')).every((n) => n === 'Carla do Cobrador')).toBe(true)
    })
    it('venda de outro escopo dá 404', async () => {
      const deB = (await db!('vendas').where({ cliente_id: id.cB }).first()).id
      expect((await req('GET', `/api/vendas/${deB}`, 'vendedorA')).statusCode).toBe(404)
      expect((await req('GET', `/api/vendas/${deB}`, 'cobrador')).statusCode).toBe(404)
      expect((await req('GET', `/api/vendas/${deB}`, 'admin')).statusCode).toBe(200)
      expect((await req('GET', '/api/vendas/abc', 'admin')).statusCode).toBe(400)
    })
    it('pagamentos entram na conta; transação desfeita não conta; parcela quitada some das atrasadas', async () => {
      const v = (await vender('admin', await corpoBase({ entrada: 1500, parcelas: 3 }))).json() // 6.000 × 1,3 ÷ 3 = 3 × 2.600
      const parcelas = await db!('venda_parcelas').where({ venda_id: v.id }).orderBy('numero')
      const pagar = async (parcelaId: number, valor: number, desfeita = false) => {
        const [{ n }] = (await db!.raw("select nextval('recibo_numero_seq') as n")).rows
        const [tr] = await db!('transacoes_recebimento').insert({ numero_recibo: Number(n), cliente_id: id.cA, valor_total: valor, forma_pagamento: 'PIX', data_recebimento: '2026-11-10', desfeita_em: desfeita ? db!.fn.now() : null }).returning('id')
        await db!('recebimentos').insert({ transacao_id: tr.id, tipo: 'PARCELA', venda_parcela_id: parcelaId, valor })
      }
      await pagar(parcelas[0].id, 2600)
      await pagar(parcelas[1].id, 500)
      await pagar(parcelas[2].id, 2600, true) // desfeita: não conta
      hoje = '2026-12-20' // 1ª e 2ª vencidas; a 3ª vence em jan
      const f = (await req('GET', `/api/vendas/${v.id}`, 'admin')).json()
      expect(f.parcelas.map((p: { pago: number }) => p.pago)).toEqual([2600, 500, 0])
      expect(f).toMatchObject({ recebido: 1500 + 2600 + 500, falta: 2100 + 2600, atrasadas: 1 }) // só a 2ª (parcial) está vencida e aberta
      expect(f.parcelas[1].falta).toBe(2100)
    })
    it('filtra por status: em andamento, com atraso e quitadas', async () => {
      hoje = '2027-06-01'
      const atraso = (await req('GET', '/api/vendas?status=ATRASO&limite=100', 'admin')).json()
      expect(atraso.itens.length).toBeGreaterThan(0)
      expect(atraso.itens.every((x: { atrasadas: number; status: string }) => x.atrasadas > 0 && x.status === 'ATIVA')).toBe(true)
      const quit = (await req('GET', '/api/vendas?status=QUITADA&limite=100', 'admin')).json()
      expect(quit.itens.every((x: { falta: number }) => x.falta === 0)).toBe(true)
      expect((await req('GET', '/api/vendas?status=XYZ', 'admin')).statusCode).toBe(400)
    })
    it('pagina e corta o limite em 100', async () => {
      const p = (await req('GET', '/api/vendas?limite=3&pagina=1', 'admin')).json()
      expect(p.itens).toHaveLength(3)
      expect(p.total).toBeGreaterThan(3)
      expect((await req('GET', '/api/vendas?limite=99999', 'admin')).json().limite).toBe(100)
    })
    it('resumo: admin recebe os 3 números; os outros só "a receber"', async () => {
      const adm = (await req('GET', '/api/vendas/resumo', 'admin')).json()
      expect(Object.keys(adm).sort()).toEqual(['aReceber', 'capitalNaRua', 'lucroPorVir'])
      expect(adm.aReceber).toBeGreaterThan(0)
      expect(Object.keys((await req('GET', '/api/vendas/resumo', 'vendedorA')).json())).toEqual(['aReceber'])
    })
  })

  describe('auditoria e configuração', () => {
    it('grava quem vendeu, com os números da venda', async () => {
      const v = (await vender('vendedorA', await corpoBase())).json()
      const aud = await db!('auditoria').where({ acao: 'VENDA_CRIADA', entidade_id: v.id }).first()
      expect(aud).toMatchObject({ usuario_id: id.vendedorA })
      expect(aud.depois).toMatchObject({ preco: 7500, entrada: 1500, parcelas: 10, total: 13500 })
    })
    it('a taxa de juros só é lida por quem vende (admin e vendedor)', async () => {
      expect((await req('GET', '/api/config/juros', 'vendedorA')).json()).toEqual({ pct: 10, maxParcelas: 10 })
      expect((await req('GET', '/api/config/juros', 'admin')).statusCode).toBe(200)
      for (const papel of ['cobrador', 'indicador']) expect((await req('GET', '/api/config/juros', papel)).statusCode).toBe(403)
    })
    it('o vendedor vê as opções de indicador sem o %', async () => {
      const r = await req('GET', '/api/indicadores/opcoes', 'vendedorA')
      expect(r.statusCode).toBe(200)
      expect(r.body).not.toMatch(/pct|%/)
      expect((r.json() as { nome: string }[]).map((x) => x.nome)).toContain('Roberto')
      expect((await req('GET', '/api/indicadores/opcoes', 'cobrador')).statusCode).toBe(403)
    })
  })
})
