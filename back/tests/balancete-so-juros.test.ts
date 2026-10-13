import type { Knex } from 'knex'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCaixaRepository } from '../src/modules/caixa/models/repository.js'
import { createEmprestimosRepository } from '../src/modules/emprestimos/models/repository.js'
import { jurosPorVencerSoJuros } from '../src/modules/emprestimos/services/calculo.js'
import { createIndicadoresRepository } from '../src/modules/indicadores/models/repository.js'
import { createRelatoriosRepository } from '../src/modules/relatorios/models/repository.js'
import { createRelatoriosService } from '../src/modules/relatorios/services/relatorios.service.js'
import { createAuditoriaRepository } from '../src/modules/auditoria/models/repository.js'
import { createRepassesRepository } from '../src/modules/repasses/models/repository.js'
import { createRepassesService } from '../src/modules/repasses/services/repasses.service.js'
import { calcularRepasse, vaiLiberarSemJurosPorVencer } from '../src/modules/repasses/services/calculo.js'
import { createVendasRepository } from '../src/modules/vendas/models/repository.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const HOJE = '2026-10-15'
const ADMIN = { perfil: 'ADMIN', usuarioId: 1 } as never
const parc = (numero: number, vencimento: string, valor: number, o: { pago?: number; desconto?: number; acordo?: string | null } = {}) => ({ numero, vencimento, valor, desconto: 0, pago: 0, acordo: null, ...o })
const soJuros = (parcelas: ReturnType<typeof parc>[], o: { capital?: number; amortizado?: number; modalidade?: 'JUROS' | 'PARCELADO' } = {}) => ({ modalidade: 'JUROS' as const, capital: 2000, amortizado: 0, parcelas, ...o })

describe('jurosPorVencerSoJuros (conta pura)', () => {
  const plano = [parc(1, '2026-10-10', 200), parc(2, '2026-11-10', 200), parc(3, '2026-12-10', 200), parc(4, '2027-01-10', 2200)]
  it('só o juro que ainda não venceu sai; o capital da última continua valendo', () => {
    expect(jurosPorVencerSoJuros(soJuros(plano), HOJE)).toBe(600)
  })
  it('parcela que vence hoje já é exigível', () => {
    expect(jurosPorVencerSoJuros(soJuros([parc(1, HOJE, 200), parc(2, '2026-11-15', 2200)]), HOJE)).toBe(200)
  })
  it('depois que a última venceu, tudo o que falta é exigível', () => {
    expect(jurosPorVencerSoJuros(soJuros([parc(1, '2026-09-10', 200), parc(2, '2026-10-10', 2200)]), HOJE)).toBe(0)
  })
  it('amortização: o capital em aberto é menor, então a última leva menos capital e sobra mais juro por vencer', () => {
    // capital 2000, já amortizou 500; a última agora é 1500 + 150 de juro
    expect(jurosPorVencerSoJuros(soJuros([parc(1, '2026-11-10', 150), parc(2, '2026-12-10', 1650)], { amortizado: 500 }), HOJE)).toBe(150 + 150)
  })
  it('parcela paga ou com desconto não conta como falta', () => {
    expect(jurosPorVencerSoJuros(soJuros([parc(1, '2026-11-10', 200, { pago: 200 }), parc(2, '2026-12-10', 200, { desconto: 50 }), parc(3, '2027-01-10', 2200)]), HOJE)).toBe(350) // falta 0 + 150 + 2200, menos 2000 de capital na última: 150 de juro da 2ª + 200 da última
  })
  it('outra modalidade e só juros com acordo (parcelas fixas): nada é tirado', () => {
    expect(jurosPorVencerSoJuros(soJuros(plano, { modalidade: 'PARCELADO' as never }), HOJE)).toBe(0)
    expect(jurosPorVencerSoJuros(soJuros([...plano.slice(0, 3), parc(5, '2027-02-10', 500, { acordo: 'NOVA' })]), HOJE)).toBe(0)
  })
  it('sem parcelas não quebra', () => { expect(jurosPorVencerSoJuros(soJuros([]), HOJE)).toBe(0) })
})

describe('vaiLiberarSemJurosPorVencer', () => {
  const base = { total: 2800, descontos: 0, investido: 2000, pct: 0.5, liberado: 0 }
  it('tira o juro por vencer do lucro previsto antes de aplicar o %', () => {
    expect(vaiLiberarSemJurosPorVencer(base, 600)).toBe(100) // (2800 − 600 − 2000) × 0,5
  })
  it('sem juro por vencer é o mesmo valor da tela de repasses', () => {
    const r = calcularRepasse([{ tipo: 'EMPRESTIMO', id: 1, data: '2026-09-01', clienteNome: 'A', descricao: 'x', status: 'ATIVA', recebido: 300, ...base }], 0)
    expect(vaiLiberarSemJurosPorVencer({ ...base, liberado: r.operacoes[0].liberado }, 0)).toBe(r.operacoes[0].vaiLiberar)
  })
  it('o que já foi liberado abate, e nunca fica negativo', () => {
    expect(vaiLiberarSemJurosPorVencer({ ...base, liberado: 80 }, 600)).toBe(20)
    expect(vaiLiberarSemJurosPorVencer({ ...base, liberado: 500 }, 600)).toBe(0)
    expect(vaiLiberarSemJurosPorVencer({ ...base, total: 2100 }, 600)).toBe(0)
  })
})

const db: Knex | null = await bancoDeTeste()

describe.skipIf(!db)('balancete com só juros (Postgres de verdade)', () => {
  const id: Record<string, number> = {}
  let ver: () => ReturnType<ReturnType<typeof createRelatoriosService>['ver']>
  let repasses: ReturnType<typeof createRepassesService>

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    id.ind = (await k('indicadores').insert({ nome: 'Roberto', pct: 0.5 }).returning('id'))[0].id
    id.cli = (await k('clientes').insert({ nome: 'ANA SOUZA', fone: '11988124410' }).returning('id'))[0].id
    // só juros comum (capital primeiro), indicador 50%: capital 2000, juro 200 por parcela, a última leva o capital. A 1ª venceu e não foi paga.
    id.e = (await k('emprestimos').insert({ cliente_id: id.cli, data_emprestimo: '2026-09-10', capital: 2000, modalidade: 'JUROS', taxa: 10, indicador_id: id.ind, percentual_indicador: 0.5 }).returning('id'))[0].id
    await k('emprestimo_parcelas').insert([[1, '2026-10-10', 200], [2, '2026-11-10', 200], [3, '2026-12-10', 200], [4, '2027-01-10', 2200]].map(([numero, vencimento, valor]) => ({ emprestimo_id: id.e, numero, vencimento, valor })))
    const vendas = createVendasRepository(k), emprestimos = createEmprestimosRepository(k), indicadores = createIndicadoresRepository(k)
    repasses = createRepassesService({ repo: createRepassesRepository(k), indicadores, vendas, emprestimos, auditoria: createAuditoriaRepository(k), hoje: () => HOJE })
    const service = createRelatoriosService({ repo: createRelatoriosRepository(k), vendas, emprestimos, caixa: createCaixaRepository(k), indicadores, repasses, hoje: () => HOJE })
    ver = () => service.ver(ADMIN)
  })
  afterAll(async () => { await db?.destroy() })

  it('a receber = capital em aberto + juro já vencido; o juro por vencer aparece à parte', async () => {
    const b = (await ver()).balancete
    expect(b.aReceberEmprestimos).toBe(2000 + 200) // falta 2800, menos 600 de juro que ainda não venceu
    expect(b.jurosPorVencer).toBe(600)
  })
  it('a parte futura do indicador acompanha: 50% só do que já é exigível', async () => {
    const b = (await ver()).balancete
    expect(b.parteFuturaIndicadores).toBe(100) // lucro exigível 200 (o juro vencido) × 50%
    expect(b.passivo).toBe(100)
    expect(b.patrimonio).toBe(b.ativo - 100)
  })
  it('a tela de Repasses não muda: o indicador continua vendo a parte cheia (400)', async () => {
    expect((await repasses.resumo(ADMIN))[0].resumo.vaiLiberar).toBe(400)
  })
  it('quando o cliente paga a parcela vencida, sai do a receber e vira caixa/lucro, e o juro por vencer não muda', async () => {
    const k = db!
    const [p1] = await k('emprestimo_parcelas').where({ emprestimo_id: id.e, numero: 1 })
    const [tr] = await k('transacoes_recebimento').insert({ numero_recibo: 1, cliente_id: id.cli, valor_total: 200, forma_pagamento: 'PIX', data_recebimento: '2026-10-14', resumo: JSON.stringify({ referencia: 'x' }) }).returning('id')
    await k('recebimentos').insert({ transacao_id: tr.id, tipo: 'PARCELA', emprestimo_parcela_id: p1.id, valor: 200 })
    const b = (await ver()).balancete
    expect(b.aReceberEmprestimos).toBe(2000)
    expect(b.jurosPorVencer).toBe(600)
  })
})
