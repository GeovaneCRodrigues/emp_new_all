import type { Knex } from 'knex'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { EstadoAntigo, OperacaoAntiga, RecebimentoAntigo } from '../src/migracao/antigo/tipos.js'
import { formatarRelatorioOperacoes, importarOperacoes } from '../src/migracao/importar-operacoes.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()
const HOJE = '2026-10-09'

const op = (id: number, o: Partial<OperacaoAntiga> = {}): OperacaoAntiga => ({
  id, clienteId: 10, dataInicio: '2026-05-05', diaVencimento: 10, modalidade: 'PARCELADO', periodicidade: 'MENSAL', valorOriginal: 1500, taxaJurosMes: 0, valorRecebimentoMensal: 500,
  qtdeParcelasRecuperacao: 0, qtdeParcelasLucro: 4, percentualParceiro: 0, modoDivisaoParceiro: null, indicadorId: null, status: 'EM ANDAMENTO', obs: null, criadoEm: '2026-05-05T12:00:00Z', ...o,
})
let seq = 100
const rec = (operacaoId: number, parcelaId: string, valor: number, data: string, o: Partial<RecebimentoAntigo> = {}): RecebimentoAntigo => ({
  id: ++seq, parcelaId, operacaoId, valor, tipo: 'integral', saldoRemanescente: 0, novaParcelaId: null, prazoDias: null, dataPagamento: data, obs: null, cobradoPor: 'OWNER', forma: null, criadoEm: null, ...o,
})
const vazio = (): EstadoAntigo => ({ operacoes: [], recebimentos: [], parcelasExtras: [], parcelaAjustes: {}, parcelaVencimentos: {}, quitacoes: [], acordos: [], repassesBaixas: [], repassesPagamentos: [], transferencias: [], movimentacoesCaixa: [] })

describe.skipIf(!db)('importar empréstimos e recebimentos do sistema antigo (Postgres de verdade)', () => {
  const conta = async (t: string) => Number(((await db!(t).count('* as n').first()) as { n: string }).n)
  const soma = async (t: string, c: string) => Number(((await db!(t).sum({ s: c }).first()) as { s: string | null }).s ?? 0)
  beforeEach(async () => {
    await limparBanco(db!)
    await db!('indicadores').insert({ nome: 'IND UM', pct: 0.5, pct_manual: false, ativo: true, legacy_id: 1 })
    await db!('clientes').insert([{ nome: 'CLIENTE A', fone: '', legacy_id: 10 }, { nome: 'CLIENTE B', fone: '', legacy_id: 11 }])
  })
  afterAll(async () => { await db?.destroy() })

  const cenario = (): EstadoAntigo => ({
    ...vazio(),
    operacoes: [
      op(1, { indicadorId: 1, percentualParceiro: 0.5 }),
      op(2, { clienteId: 11, modalidade: 'JUROS', valorOriginal: 3000, valorRecebimentoMensal: 300, qtdeParcelasLucro: 0, indicadorId: 1, percentualParceiro: 0.5, modoDivisaoParceiro: 'JUROS_MENSAL' }),
    ],
    recebimentos: [rec(1, '1-1', 500, '2026-05-10'), rec(1, '1-2', 500, '2026-06-10', { cobradoPor: 'INDICADOR', forma: 'DINHEIRO' }), rec(2, '2-1', 300, '2026-05-10')],
    repassesBaixas: [{ id: 1, recebimentoId: 1, operacaoId: 1, indicadorId: 1, valor: 250, dataRepasse: '2026-05-12', obs: null }],
    repassesPagamentos: [{ id: 1, indicadorId: 1, valor: 100, dataPagamento: '2026-06-01', obs: 'adiantamento' }],
    transferencias: [{ id: 1, indicadorId: 1, valor: 500, dataTransferencia: '2026-06-11', obs: null }],
    movimentacoesCaixa: [{ id: 1, tipo: 'APORTE', valor: 7500, data: '2026-05-01', obs: 'aporte inicial' }],
  })

  it('SIMULAÇÃO: o relatório é completo mas NADA é gravado', async () => {
    const r = await importarOperacoes(db!, cenario(), { aplicar: false, hoje: HOJE })
    expect(r.modo).toBe('SIMULACAO')
    expect(r.emprestimos).toMatchObject({ origem: 2, criados: 2 }); expect(r.recibos).toBe(3); expect(r.totais.recebido).toBe(1300)
    for (const t of ['emprestimos', 'emprestimo_parcelas', 'transacoes_recebimento', 'recebimentos', 'repasses_indicador', 'movimentacoes_caixa']) expect(await conta(t), t).toBe(0)
  })

  it('APLICAR: grava empréstimos, parcelas, recibos, repasses e caixa, e as conferências fecham', async () => {
    const r = await importarOperacoes(db!, cenario(), { aplicar: true, hoje: HOJE })
    expect(r.modo).toBe('APLICADO')
    expect(r.conferencias.length).toBeGreaterThanOrEqual(10)
    expect(await conta('emprestimos')).toBe(2); expect(await conta('transacoes_recebimento')).toBe(3); expect(await conta('recebimentos')).toBe(3)
    expect(await soma('recebimentos', 'valor')).toBe(1300)
    expect(await soma('repasses_indicador', 'valor')).toBe(350); expect(await soma('movimentacoes_caixa', 'valor')).toBe(8000)
    const e1 = await db!('emprestimos').where({ legacy_id: 1 }).first()
    expect(e1).toMatchObject({ modalidade: 'PARCELADO', modo_divisao: 'CAPITAL_PRIMEIRO', status: 'ATIVA', legacy_id: 1 }); expect(Number(e1.percentual_indicador)).toBe(0.5); expect(Number(e1.capital)).toBe(1500)
    expect((await db!('emprestimos').where({ legacy_id: 2 }).first()).modo_divisao).toBe('JUROS_MENSAL')
    const ind = await db!('indicadores').where({ legacy_id: 1 }).first(); const cli = await db!('clientes').where({ legacy_id: 10 }).first()
    expect(e1.indicador_id).toBe(ind.id); expect(e1.cliente_id).toBe(cli.id)
  })

  it('os recibos saem numerados por data, com forma estimada (Pix) ou a registrada, e quem cobrou', async () => {
    const c = cenario()
    await importarOperacoes(db!, c, { aplicar: true, hoje: HOJE })
    const t = await db!('transacoes_recebimento').orderBy('numero_recibo')
    const rs = c.recebimentos // 1ª parcela da op 1 e da op 2 são de 10/05; a 2ª parcela da op 1 é de 10/06
    expect(t.map((x) => x.legacy_id)).toEqual([rs[0].id, rs[2].id, rs[1].id])
    expect(t.map((x) => [x.forma_pagamento, x.forma_estimada])).toEqual([['PIX', true], ['PIX', true], ['DINHEIRO', false]])
    const ind = await db!('indicadores').where({ legacy_id: 1 }).first()
    expect(t.map((x) => x.cobrado_por_indicador_id)).toEqual([null, null, ind.id]); expect(t[0].recebido_por).toBeNull()
    expect(t[0].resumo).toMatchObject({ tipo: 'PARCELAS', referencia: 'parcela 1/4' })
  })

  it('as parcelas guardam a data original e o estado "antes" de cada recebimento, para o desfazer', async () => {
    await importarOperacoes(db!, cenario(), { aplicar: true, hoje: HOJE })
    const p = await db!('emprestimo_parcelas as p').join('emprestimos as e', 'e.id', 'p.emprestimo_id').where('e.legacy_id', 1).orderBy('p.numero').select('p.*')
    expect(p.map((x) => [x.numero, Number(x.valor), x.quitada_em ? String(x.quitada_em).length : null])).toHaveLength(4)
    expect(p[0].legacy_parcela).toBe('1-1')
    const r = await db!('recebimentos').orderBy('id').first()
    expect(r.antes).toEqual({ vencimento: '2026-05-10', vencimentoOriginal: null, desconto: 0, quitadaEm: null })
  })

  it('RODAR DE NOVO não duplica nada', async () => {
    await importarOperacoes(db!, cenario(), { aplicar: true, hoje: HOJE })
    const antes = { e: await conta('emprestimos'), t: await conta('transacoes_recebimento'), r: await conta('repasses_indicador'), c: await conta('movimentacoes_caixa') }
    const r = await importarOperacoes(db!, cenario(), { aplicar: true, hoje: HOJE })
    expect(r.emprestimos).toMatchObject({ criados: 0, jaExistiam: 2 }); expect(r.recibos).toBe(0)
    expect(r.repasses).toMatchObject({ criados: 0, jaExistiam: 2 }); expect(r.caixa).toMatchObject({ criados: 0, jaExistiam: 2 })
    expect({ e: await conta('emprestimos'), t: await conta('transacoes_recebimento'), r: await conta('repasses_indicador'), c: await conta('movimentacoes_caixa') }).toEqual(antes)
  })

  it('operação de cliente que não foi importado fica de fora, com o motivo (e não derruba o resto)', async () => {
    const e = cenario(); e.operacoes.push(op(3, { clienteId: 999 })); e.recebimentos.push(rec(3, '3-1', 500, '2026-05-10'))
    const r = await importarOperacoes(db!, e, { aplicar: true, hoje: HOJE })
    expect(r.emprestimos).toMatchObject({ criados: 2, semCliente: 1 }); expect(r.problemas).toEqual([{ entidade: 'operação', legacyId: 3, motivo: 'o cliente ainda não foi importado' }])
    expect(await conta('emprestimos')).toBe(2); expect(r.totais.recebido).toBe(1300)
  })

  it('operação com indicador que não foi importado fica de fora; repasse de indicador desconhecido também', async () => {
    const e = cenario(); e.operacoes.push(op(3, { indicadorId: 77, percentualParceiro: 0.5 })); e.repassesPagamentos.push({ id: 9, indicadorId: 77, valor: 10, dataPagamento: '2026-06-02', obs: null })
    const r = await importarOperacoes(db!, e, { aplicar: true, hoje: HOJE })
    expect(r.emprestimos.semIndicador).toBe(1); expect(r.repasses.semIndicador).toBe(1); expect(await conta('repasses_indicador')).toBe(2)
  })

  it('acordo: grava o acordo, liga as parcelas dele e guarda as parcelas de antes', async () => {
    const e = vazio()
    e.operacoes = [op(5, { qtdeParcelasLucro: 6, valorOriginal: 2000 })]
    e.recebimentos = [rec(5, '5-1', 500, '2026-05-10'), rec(5, 'acordo-1-1', 400, '2026-08-15')]
    e.parcelasExtras = [1, 2].map((n) => ({ id: `acordo-1-${n}`, operacaoId: 5, parcelaOrigemId: '5-2', parcelaNumero: n, totalParcelas: 2, vencimentoIso: `2026-0${7 + n}-15`, valor: 400, fase: 'ACORDO', modalidade: 'PARCELADO' }))
    e.acordos = [{ id: 1, operacaoId: 5, valorTotal: 800, capitalAdicional: 300, qtdeParcelas: 2, valorParcela: 400, dataPrimeiraParcela: '2026-08-15', diaVencimento: 15, periodicidade: 'MENSAL', dataAcordo: '2026-08-01', obs: 'renegociou' }]
    const r = await importarOperacoes(db!, e, { aplicar: true, hoje: HOJE })
    expect(r.acordos).toBe(1)
    const a = await db!('acordos').first()
    expect(a).toMatchObject({ legacy_id: 1, status: 'ATIVO', n_parcelas: 2, motivo: 'renegociou' }); expect(Number(a.valor_total)).toBe(800)
    const emp = await db!('emprestimos').first(); expect(Number(emp.capital)).toBe(2300)
    const parc = await db!('emprestimo_parcelas').orderBy('numero')
    expect(parc.map((p) => p.acordo_id)).toEqual([null, a.id, a.id]); expect(parc.map((p) => Number(p.valor))).toEqual([500, 400, 400])
    expect(await soma('recebimentos', 'valor')).toBe(900)
  })

  it('uma conferência que falha desfaz TUDO (nada fica pela metade)', async () => {
    const e = cenario()
    // corrompe de propósito: dois recibos com o mesmo id antigo violam o índice único e a carga inteira volta
    e.recebimentos.push({ ...e.recebimentos[0] })
    await expect(importarOperacoes(db!, e, { aplicar: true, hoje: HOJE })).rejects.toThrow()
    for (const t of ['emprestimos', 'emprestimo_parcelas', 'transacoes_recebimento', 'recebimentos', 'repasses_indicador', 'movimentacoes_caixa']) expect(await conta(t), t).toBe(0)
  })

  it('o relatório em texto não leva nome nem dado pessoal', async () => {
    const txt = formatarRelatorioOperacoes(await importarOperacoes(db!, cenario(), { aplicar: false, hoje: HOJE }))
    expect(txt).toContain('SIMULAÇÃO'); expect(txt).toContain('Empréstimos: 2'); expect(txt).not.toMatch(/CLIENTE A|IND UM/)
  })
})
