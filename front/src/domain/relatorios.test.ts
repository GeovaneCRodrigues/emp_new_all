import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { jurosPorVencerSoJuros } from './emprestimo'
import { vaiLiberarSemJurosPorVencer } from './repasseIndicador'
import { janela, lucroPorMesTodos, lucroRealizadoAte, montarRelatorios, somaMes, type OpRelatorio } from './relatorios'

const op = (o: Partial<OpRelatorio> = {}): OpRelatorio => ({
  tipo: 'EMPRESTIMO', id: 1, data: '2026-09-01', status: 'ATIVA', indicadorId: null, pct: 0, investido: 1000, total: 1500, recebido: 0, falta: 1500, lucroTotal: 500, capitalDeVolta: 0,
  jurosRecebidos: null, jurosPorVencer: 0, parteFuturaAbatida: 0, aCobrar: [], modelo: null, diasParado: null, parcelas: [], entradas: [], ...o,
})

describe('relatórios (cópia do cálculo do backend)', () => {
  it('dá o mesmo resultado que o backend no cenário combinado (arquivo gerado pelo backend)', () => {
    const f = JSON.parse(readFileSync(new URL('../../../back/tests/fixtures/relatorios/paridade.json', import.meta.url), 'utf8'))
    expect(montarRelatorios(f.ops, f.extras)).toEqual(f.esperado)
  })
  it('o capital volta primeiro; o resto é lucro, sem a parte do indicador', () => {
    expect(lucroRealizadoAte(op(), 1000)).toBe(0); expect(lucroRealizadoAte(op(), 1200)).toBe(200); expect(lucroRealizadoAte(op({ pct: 0.5 }), 1200)).toBe(100)
  })
  it('lucro por mês na ordem do dinheiro que entrou', () => {
    const o = op({ recebido: 1600, entradas: [{ data: '2026-10-05', valor: 400 }, { data: '2026-08-10', valor: 600 }, { data: '2026-09-10', valor: 600 }] })
    expect([...lucroPorMesTodos([o])]).toEqual([['2026-09', 200], ['2026-10', 400]])
  })
  it('meses atravessam o ano', () => {
    expect(somaMes('2026-11', 3)).toBe('2027-02'); expect(janela('2026-10-10', -3, 3)).toHaveLength(7)
  })
  it('balancete: o juro de só juros que ainda não venceu não é patrimônio, nem a parte futura do indicador sobre ele', () => {
    const soJuros = op({ id: 2, indicadorId: 7, pct: 0.5, total: 2200, falta: 2200, lucroTotal: 1200, jurosPorVencer: 1000, parteFuturaAbatida: 500 })
    const x = { hoje: '2026-10-10', caixa: 1000, estoque: 0, aportes: 0, repassesAPagar: 30, repassesFuturos: 600, indicadores: [] }
    expect(montarRelatorios([op({ falta: 100 }), soJuros], x).balancete).toMatchObject({ aReceberEmprestimos: 1300, jurosPorVencer: 1000, ativo: 2300, parteFuturaIndicadores: 100, passivo: 130, patrimonio: 2170 })
  })
  it('jurosPorVencerSoJuros: só o juro que não venceu sai; o capital da última fica', () => {
    const p = (numero: number, vencimento: string, valor: number, o = {}) => ({ numero, vencimento, valor, desconto: 0, pago: 0, acordo: null, ...o })
    const plano = [p(1, '2026-10-10', 200), p(2, '2026-11-10', 200), p(3, '2026-12-10', 200), p(4, '2027-01-10', 2200)]
    const e = { modalidade: 'JUROS' as const, capital: 2000, amortizado: 0, parcelas: plano }
    expect(jurosPorVencerSoJuros(e, '2026-10-15')).toBe(600)
    expect(jurosPorVencerSoJuros({ ...e, parcelas: [p(1, '2026-09-10', 200), p(2, '2026-10-10', 2200)] }, '2026-10-15')).toBe(0)
    expect(jurosPorVencerSoJuros({ ...e, amortizado: 500, parcelas: [p(1, '2026-11-10', 150), p(2, '2026-12-10', 1650)] }, '2026-10-15')).toBe(300)
    expect(jurosPorVencerSoJuros({ ...e, modalidade: 'PARCELADO' as never }, '2026-10-15')).toBe(0)
    expect(jurosPorVencerSoJuros({ ...e, parcelas: [...plano.slice(0, 3), p(5, '2027-02-10', 500, { acordo: 'NOVA' })] }, '2026-10-15')).toBe(0)
  })
  it('jurosPorVencerSoJuros: parcela remarcada (pagou parte) segue vencida pela data original', () => {
    const p = (numero: number, vencimento: string, valor: number, o = {}) => ({ numero, vencimento, valor, desconto: 0, pago: 0, acordo: null, ...o })
    const e = { modalidade: 'JUROS' as const, capital: 2000, amortizado: 0, parcelas: [p(1, '2026-09-10', 200, { pago: 200 }), p(2, '2026-10-22', 200, { pago: 0.01, vencimentoOriginal: '2026-10-10' }), p(3, '2026-11-10', 200), p(4, '2026-12-10', 2200)] }
    expect(jurosPorVencerSoJuros(e, '2026-10-15')).toBe(400)
    expect(jurosPorVencerSoJuros({ ...e, parcelas: e.parcelas.map((x) => ({ ...x, vencimentoOriginal: undefined })) }, '2026-10-15')).toBeGreaterThan(400)
  })
  it('vaiLiberarSemJurosPorVencer: tira o juro por vencer antes do %, abate o liberado e nunca fica negativo', () => {
    const b = { total: 2800, descontos: 0, investido: 2000, pct: 0.5, liberado: 0 }
    expect(vaiLiberarSemJurosPorVencer(b, 600)).toBe(100); expect(vaiLiberarSemJurosPorVencer({ ...b, liberado: 80 }, 600)).toBe(20); expect(vaiLiberarSemJurosPorVencer({ ...b, liberado: 500 }, 600)).toBe(0)
  })
  it('previsão: atraso por faixa, a vencer por mês, vence hoje é a vencer, quitada fora', () => {
    const a = op({ aCobrar: [{ vencimento: '2026-10-09', falta: 100 }, { vencimento: '2026-10-03', falta: 50 }, { vencimento: '2026-09-10', falta: 200 }, { vencimento: '2026-08-01', falta: 300 }, { vencimento: '2026-10-10', falta: 40 }, { vencimento: '2026-10-25', falta: 60 }, { vencimento: '2026-12-05', falta: 70 }] })
    const quitada = op({ id: 2, status: 'QUITADA', aCobrar: [{ vencimento: '2026-11-01', falta: 999 }] })
    const p = montarRelatorios([a, quitada], { hoje: '2026-10-10', caixa: 1000, estoque: 500, aportes: 0, repassesAPagar: 30, repassesFuturos: 80, indicadores: [] }).previsao
    expect(p.atraso).toEqual({ ate7: { n: 2, valor: 150 }, de8a30: { n: 1, valor: 200 }, mais30: { n: 1, valor: 300 } })
    expect(p.aVencer).toEqual({ n: 3, valor: 170 })
    expect(p.porMes).toEqual([{ mes: '2026-10', valor: 100 }, { mes: '2026-11', valor: 0 }, { mes: '2026-12', valor: 70 }])
  })
})
