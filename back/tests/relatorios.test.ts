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
import { createConfigRepository } from '../src/modules/config/models/repository.js'
import { createConfigService } from '../src/modules/config/services/config.service.js'
import { createEmprestimosRepository } from '../src/modules/emprestimos/models/repository.js'
import { createEstoqueRepository } from '../src/modules/estoque/models/repository.js'
import { createEstoqueService } from '../src/modules/estoque/services/estoque.service.js'
import { createIndicadoresRepository } from '../src/modules/indicadores/models/repository.js'
import { createIndicadoresService } from '../src/modules/indicadores/services/indicadores.service.js'
import { createRelatoriosRepository } from '../src/modules/relatorios/models/repository.js'
import { createRelatoriosService } from '../src/modules/relatorios/services/relatorios.service.js'
import { createRepassesRepository } from '../src/modules/repasses/models/repository.js'
import { createRepassesService } from '../src/modules/repasses/services/repasses.service.js'
import { createVendasRepository } from '../src/modules/vendas/models/repository.js'
import type { Relatorios } from '../src/modules/relatorios/services/calculo.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()
const SENHA = 'senha-forte-123'
const HOJE = '2026-10-15'

describe.skipIf(!db)('relatórios (Postgres de verdade)', () => {
  let app: FastifyInstance
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}
  const get = (papel?: string) => app.inject({ method: 'GET', url: '/api/relatorios', headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  const rel = async () => (await get('admin')).json() as Relatorios

  let n = 0
  async function recibo(clienteId: number, valor: number, data: string, vinculo: { vendaParcela?: number; empParcela?: number; entradaVenda?: number }, o: { desfeito?: boolean; ajustes?: object } = {}) {
    const [tr] = await db!('transacoes_recebimento').insert({
      numero_recibo: ++n, cliente_id: clienteId, valor_total: valor, forma_pagamento: 'PIX', data_recebimento: data, desfeita_em: o.desfeito ? new Date() : null,
      ajustes: o.ajustes ? JSON.stringify(o.ajustes) : null, resumo: JSON.stringify({ referencia: 'x' }),
    }).returning('id')
    if (vinculo.entradaVenda) await db!('recebimentos').insert({ transacao_id: tr.id, tipo: 'ENTRADA', venda_id: vinculo.entradaVenda, valor })
    else await db!('recebimentos').insert({ transacao_id: tr.id, tipo: 'PARCELA', venda_parcela_id: vinculo.vendaParcela ?? null, emprestimo_parcela_id: vinculo.empParcela ?? null, valor })
  }
  const bem = async (o: Record<string, unknown> = {}) => (await db!('bens').insert({ modelo: 'IPHONE 13', gb: 128, cor: 'PRETO', preco_venda: 3000, valor_compra: 2000, custos_extras: 0, data_compra: '2026-08-01', ...o }).returning('id'))[0].id as number
  const venda = async (o: Record<string, unknown>) => (await db!('vendas').insert({ cliente_id: id.cli, ...o }).returning('id'))[0].id as number
  const parcela = async (tabela: 'venda_parcelas' | 'emprestimo_parcelas', fk: string, opId: number, numero: number, vencimento: string, valor: number) =>
    (await db!(tabela).insert({ [fk]: opId, numero, vencimento, valor }).returning('id'))[0].id as number
  const emp = async (o: Record<string, unknown>) => (await db!('emprestimos').insert({ cliente_id: id.cli, modalidade: 'PARCELADO', taxa: 50, ...o }).returning('id'))[0].id as number

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    const hash = await hashSenha(SENHA)
    id.ind = (await k('indicadores').insert({ nome: 'Roberto', pct: 0.5 }).returning('id'))[0].id
    for (const [c, perfil, extra] of [['admin', 'ADMIN', {}], ['vendedor', 'VENDEDOR', {}], ['cobrador', 'COBRADOR', {}], ['indicador', 'INDICADOR', { indicador_id: id.ind }]] as const) {
      id[c] = (await k('users').insert({ nome: `${c} Silva`, email: `${c}@t.com`, senha_hash: hash, perfil, ...extra }).returning('id'))[0].id
    }
    id.cli = (await k('clientes').insert({ nome: 'ANA SOUZA', fone: '11988124410' }).returning('id'))[0].id

    // A) venda direta quitada: custo 2000, vendida por 3000 (entrada 500 + 2 x 1250), comprada em 01/08 e vendida em 01/09 (31 dias parado)
    const a = await venda({ bem_id: await bem({ estado: 'VENDIDO' }), data_venda: '2026-09-01', entrada: 500, valor_investido: 2000, valor_total: 3000, preco_acordado: 3000 })
    const a1 = await parcela('venda_parcelas', 'venda_id', a, 1, '2026-10-01', 1250), a2 = await parcela('venda_parcelas', 'venda_id', a, 2, '2026-11-01', 1250)
    await recibo(id.cli, 500, '2026-09-01', { entradaVenda: a }) // a entrada é recibo, mas conta na data da venda (não em dobro)
    await recibo(id.cli, 1250, '2026-10-01', { vendaParcela: a1 })
    await recibo(id.cli, 1250, '2026-10-05', { vendaParcela: a2 })
    // B) empréstimo com indicador 50%: capital 1000, paga 2 x 750 -> quitado, lucro total 500, do dono 250
    const b = await emp({ data_emprestimo: '2026-08-15', capital: 1000, indicador_id: id.ind, percentual_indicador: 0.5 })
    const b1 = await parcela('emprestimo_parcelas', 'emprestimo_id', b, 1, '2026-09-15', 750), b2 = await parcela('emprestimo_parcelas', 'emprestimo_id', b, 2, '2026-10-02', 750)
    await recibo(id.cli, 750, '2026-09-15', { empParcela: b1 }); await recibo(id.cli, 750, '2026-10-02', { empParcela: b2 })
    // C) empréstimo ativo, sem indicador: capital 1000, 3 x 500; as 2 primeiras devolvem o capital e a 3ª paga 200 -> 200 já é lucro
    const c = await emp({ data_emprestimo: '2026-09-02', capital: 1000 })
    const c1 = await parcela('emprestimo_parcelas', 'emprestimo_id', c, 1, '2026-09-20', 500), c2 = await parcela('emprestimo_parcelas', 'emprestimo_id', c, 2, '2026-10-05', 500), c3 = await parcela('emprestimo_parcelas', 'emprestimo_id', c, 3, '2026-10-30', 500)
    await recibo(id.cli, 500, '2026-09-20', { empParcela: c1 }); await recibo(id.cli, 500, '2026-10-05', { empParcela: c2 }); await recibo(id.cli, 200, '2026-10-12', { empParcela: c3 })
    // D) fora das contas: venda retomada, empréstimo cancelado, e um recibo desfeito
    const d = await venda({ bem_id: await bem({ estado: 'DISPONIVEL' }), data_venda: '2026-09-03', valor_investido: 2000, valor_total: 2500, preco_acordado: 2500, status: 'RETOMADA' })
    await parcela('venda_parcelas', 'venda_id', d, 1, '2026-10-03', 2500)
    const e = await emp({ data_emprestimo: '2026-09-04', capital: 777, status: 'CANCELADA' })
    await parcela('emprestimo_parcelas', 'emprestimo_id', e, 1, '2026-10-04', 900)
    await recibo(id.cli, 300, '2026-10-06', { empParcela: c3 }, { desfeito: true })
    // E) só juros dividido a cada pagamento, indicador 50%: capital 1000, juros 100 por parcela (a última leva o capital). Paga a 1ª (100) e adiantou 50 de capital.
    const f = await emp({ data_emprestimo: '2026-10-03', capital: 1000, modalidade: 'JUROS', taxa: 10, indicador_id: id.ind, percentual_indicador: 0.5, modo_divisao: 'JUROS_MENSAL' })
    const f1 = await parcela('emprestimo_parcelas', 'emprestimo_id', f, 1, '2026-10-10', 100)
    await parcela('emprestimo_parcelas', 'emprestimo_id', f, 2, '2026-11-10', 100); await parcela('emprestimo_parcelas', 'emprestimo_id', f, 3, '2026-12-10', 1100)
    await recibo(id.cli, 100, '2026-10-10', { empParcela: f1 }, { ajustes: { amortizacao: 50, parcelas: [] } })
    // recibos DESFEITOS (de venda e de amortização) e um aporte no futuro: nada disso conta
    await recibo(id.cli, 999, '2026-10-06', { vendaParcela: a2 }, { desfeito: true })
    await recibo(id.cli, 100, '2026-10-06', { empParcela: f1 }, { desfeito: true, ajustes: { amortizacao: 500, parcelas: [] } })
    // estoque: o aparelho da venda retomada voltou (2000) + um disponível (custo 1800 + extras 200); o vendido não conta
    await bem({ valor_compra: 1800, custos_extras: 200, estado: 'DISPONIVEL' }); await bem({ valor_compra: 5000, estado: 'VENDIDO' })
    // caixa: aporte de abertura, uma retirada e um repasse pago
    await db!('movimentacoes_caixa').insert([{ tipo: 'APORTE', valor: 10000, data: '2026-08-01' }, { tipo: 'RETIRADA', valor: 500, data: '2026-10-01' }, { tipo: 'APORTE', valor: 777, data: '2026-11-01' }])
    await db!('repasses_indicador').insert({ indicador_id: id.ind, valor: 100, data_repasse: '2026-10-10', forma_pagamento: 'PIX' })

    const tokens = createTokensService('x'.repeat(40), '15m')
    const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
    const audit = createAuditoriaRepository(k)
    const indicadoresRepo = createIndicadoresRepository(k)
    const vendas = createVendasRepository(k), emprestimos = createEmprestimosRepository(k)
    const repasses = createRepassesService({ repo: createRepassesRepository(k), indicadores: indicadoresRepo, vendas, emprestimos, auditoria: audit, hoje: () => HOJE })
    app = await buildApp({
      env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, clientes: {} as never, usuarios: {} as never, indicadores: createIndicadoresService(indicadoresRepo, audit),
      estoque: createEstoqueService(createEstoqueRepository(k), audit), config: createConfigService(createConfigRepository(k)), vendas: {} as never, recebimentos: {} as never,
      aprovacoes: {} as never, fechamentos: {} as never, equipe: {} as never,
      relatorios: createRelatoriosService({ repo: createRelatoriosRepository(k), vendas, emprestimos, caixa: createCaixaRepository(k), indicadores: indicadoresRepo, repasses, hoje: () => HOJE }),
      limites: { vendasPorMinuto: 100_000, recebimentosPorMinuto: 100_000 },
    })
    for (const papel of ['admin', 'vendedor', 'cobrador', 'indicador']) t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  })
  afterAll(async () => { await app?.close(); await db?.destroy() })

  describe('quem pode ver', () => {
    it('sem login: 401', async () => { expect((await get()).statusCode).toBe(401) })
    it.each(['vendedor', 'cobrador', 'indicador'])('%s: 403 (custo, lucro e capital são do dono)', async (p) => { expect((await get(p)).statusCode).toBe(403) })
    it('admin: 200', async () => { expect((await get('admin')).statusCode).toBe(200) })
  })

  describe('as contas', () => {
    it('lucro por mês: o capital volta primeiro, o resto é lucro (já sem a parte do indicador)', async () => {
      const r = await rel()
      expect(r.resumo.meses).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
      // A: capital volta em 01/10 (500+1250 = 1750 < 2000) e em 05/10 (+1250 -> 1000 de lucro)
      // B: 750 em set (sem lucro), 750 em out -> 500 de lucro, 250 do dono
      // C: 500 em set, 500 em out (capital completo), 200 em 12/10 -> 200 de lucro
      // E (só juros dividido): o juro recebido (100) x 50% do dono = 50, mesmo com o capital ainda na rua
      expect(r.resumo.lucroPorMes).toEqual([0, 0, 0, 0, 0, 1500])
    })
    it('quitadas e em andamento contam; retomada, cancelada e recibo desfeito ficam de fora', async () => {
      const r = await rel()
      expect(r.investimentoELucro.iphones).toMatchObject({ investido: 2000, recebido: 3000, lucroNoBolso: 1000, lucroPorVir: 0 })
      expect(r.investimentoELucro.emprestimos).toMatchObject({ investido: 3000, recebido: 2850, lucroNoBolso: 500, lucroPorVir: 425 })
      expect(r.resumo.lucroIphones + r.resumo.lucroEmprestimos).toBe(1500)
    })
    it('a entrada da venda não conta em dobro e cai no mês da venda', async () => {
      const r = await rel()
      expect(r.investimentoELucro.recebido).toEqual([0, 0, 0, 0, 500 + 750 + 500, 1250 + 1250 + 750 + 500 + 200 + 150])
    })
    it('colocado por mês: custo do aparelho e capital emprestado, no mês de cada um', async () => {
      const r = await rel()
      expect(r.capital.colocadoPorMes).toEqual([0, 0, 0, 1000, 2000 + 1000, 1000])
      expect(r.investimentoELucro.investido).toEqual(r.capital.colocadoPorMes)
    })
    it('capital hoje: caixa + estoque + o que ainda não voltou', async () => {
      const r = await rel()
      expect(r.capital.emCaixa).toBe(r.balancete.caixa)
      expect(r.capital.noEstoque).toBe(4000)
      expect(r.capital.vendasNaRua).toBe(0); expect(r.capital.emprestimosNaRua).toBe(850) // 1000 emprestados − 150 que voltaram
    })
    it('o caixa dos relatórios é o saldo do Caixa (a mesma conta)', async () => {
      const saldo = (await createCaixaRepository(db!).resumo({ hoje: HOJE, mesIni: '2026-10-01', mesFim: HOJE })).saldo
      expect(saldo).not.toBe(0)
      expect((await rel()).balancete.caixa).toBe(saldo)
    })
    it('modelos: lucro médio da sua parte e dias parado (compra em 01/08, venda em 01/09)', async () => {
      expect((await rel()).resumo.modelos).toEqual([{ modelo: 'IPHONE 13', vendas: 1, lucroMedio: 1000, diasParado: 31 }])
    })
    it('aparelho migrado (com legacy_id) não tem dias parado conhecidos', async () => {
      await db!('bens').whereIn('id', db!('vendas').where({ data_venda: '2026-09-01' }).select('bem_id')).update({ legacy_id: 987654 })
      expect((await rel()).resumo.modelos[0].diasParado).toBeNull()
      await db!('bens').where({ legacy_id: 987654 }).update({ legacy_id: null })
    })
    it('por indicador: Direto e o indicador, com a parte de cada um', async () => {
      const l = (await rel()).porIndicador
      expect(l.map((x) => x.nome)).toEqual(['Direto', 'Roberto'])
      expect(l[0]).toMatchObject({ operacoes: 2, lucroTotal: 1500, parteDele: 0, suaParte: 1500 })
      expect(l[1]).toMatchObject({ indicadorId: id.ind, operacoes: 2, capitalNaRua: 850, lucroTotal: 850, parteDele: 425, suaParte: 425 })
    })
    it('controle mensal: previsto, recebido e em atraso pelo vencimento', async () => {
      const m = (await rel()).controleMensal
      expect(m.map((x) => x.mes)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01'])
      expect(m[2]).toMatchObject({ previsto: 750 + 500, recebido: 750 + 500, emAtraso: 0 })
      // out: A1 1250 + B2 750 + C2 500 + C3 500 + E1 100; atraso: nada (C3 vence em 30/10, depois de hoje)
      expect(m[3]).toMatchObject({ previsto: 1250 + 750 + 500 + 500 + 100, recebido: 1250 + 750 + 500 + 200 + 100, emAtraso: 0 })
      expect(m[4]).toMatchObject({ previsto: 1250 + 100, recebido: 1250, emAtraso: 0 })
      expect(m[5]).toMatchObject({ previsto: 1100, recebido: 0 })
    })
    it('balancete e patrimônio', async () => {
      const b = (await rel()).balancete
      expect(b.estoque).toBe(4000); expect(b.aReceberVendas).toBe(0); expect(b.aReceberEmprestimos).toBe(300 + 1200)
      expect(b.aportes).toBe(10000 - 500)
      expect(b.ativo).toBe(b.caixa + 4000 + 1500)
      expect(b.patrimonio).toBe(Math.round((b.ativo - b.passivo) * 100) / 100)
      expect(b.repassesAPagar).toBe(200) // B 250 + E 50 liberados menos 100 pagos
      expect(b.parteFuturaIndicadores).toBe(125) // E: 175 de parte prevista (a amortização conta como dinheiro que entrou) menos 50 já liberados
    })
  })
})
