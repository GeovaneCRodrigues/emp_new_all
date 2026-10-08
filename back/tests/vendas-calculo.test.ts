import { describe, expect, it } from 'vitest'
import { planoParc, simular, vencimentos } from '../src/modules/vendas/services/calculo.js'
import { contas, type EntradaContas } from '../src/modules/vendas/services/contas.js'

describe('planoParc: 10% por parcela, juros simples', () => {
  // preço 7.500 − entrada 1.500 = 6.000 pra parcelar
  it.each([[10, 1200, 12000], [6, 1600, 9600], [5, 1800, 9000]])('%ix → parcela %d, total %d', (n, parc, total) => {
    const p = planoParc(6000, n, 10)
    expect(p.parc).toBe(parc)
    expect(p.totalParcelas).toBe(total)
  })
  it('em 10x o cliente paga o dobro (juros = o valor parcelado)', () => expect(planoParc(6000, 10, 10).juros).toBe(6000))
  it('1x também paga os 10% (a confirmar com o Geovane)', () => expect(planoParc(6000, 1, 10).totalParcelas).toBe(6600))
  it('o % é configurável', () => expect(planoParc(1000, 4, 5).totalParcelas).toBe(1200))
  it('arredonda a parcela para cima no centavo e o cliente paga parcela × n', () => {
    const p = planoParc(1000, 3, 10) // 1300 ÷ 3 = 433,333…
    expect(p.parc).toBe(433.34)
    expect(p.totalParcelas).toBe(1300.02)
  })
  it('sem parcelas não há juros', () => expect(planoParc(0, 0, 10)).toEqual({ parc: 0, totalParcelas: 0, juros: 0 }))
})

describe('vencimentos', () => {
  it('a 1ª é no mês seguinte, no dia escolhido', () => expect(vencimentos('2026-10-08', 3, 10)).toEqual(['2026-11-10', '2026-12-10', '2027-01-10']))
  it('dia 31 cai no último dia dos meses curtos', () => expect(vencimentos('2026-01-20', 3, 31)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']))
})

describe('simular', () => {
  it('juros, total, parte do indicador, lucro e onde o capital volta', () => {
    const r = simular({ preco: 7500, entrada: 1500, troca: 0, n: 10, investido: 5000, pctIndicador: 0.5, jurosPct: 10 })
    expect(r).toMatchObject({ parcelado: 6000, parcela: 1200, juros: 6000, total: 13500, lucro: 8500, parteIndicador: 4250, seuLucro: 4250 })
    expect(r.capitalVoltaNaParcela).toBe(3) // 1.500 + 3×1.200 = 5.100 ≥ 5.000
  })
  it('a troca abate o que se parcela', () => expect(simular({ preco: 7500, entrada: 1500, troca: 1000, n: 5, investido: 0, pctIndicador: 0, jurosPct: 10 }).parcelado).toBe(5000))
  it('capital que já volta na entrada marca parcela 0', () => expect(simular({ preco: 5000, entrada: 3000, troca: 0, n: 4, investido: 2500, pctIndicador: 0, jurosPct: 10 }).capitalVoltaNaParcela).toBe(0))
  it('sem lucro, o indicador não ganha', () => expect(simular({ preco: 2000, entrada: 0, troca: 0, n: 1, investido: 3000, pctIndicador: 0.5, jurosPct: 0 }).parteIndicador).toBe(0))
})

describe('contas: o capital volta primeiro', () => {
  // custo 2.500, vendido por 4.000 no total, indicador com 50%
  const base: EntradaContas = {
    entrada: 2500, troca: 0, investido: 2500, pct: 0.5, statusGravado: 'ATIVA',
    parcelas: [{ valor: 500, desconto: 0, pago: 0, vencimento: '2026-11-01' }, { valor: 500, desconto: 0, pago: 0, vencimento: '2026-12-01' }, { valor: 500, desconto: 0, pago: 0, vencimento: '2027-01-01' }],
  }
  const paga = (n: number): EntradaContas => ({ ...base, parcelas: base.parcelas.map((p, i) => ({ ...p, pago: i < n ? p.valor : 0 })) })

  it('lucro total 1.500 e a parte do dono 750', () => expect(contas(base, '2026-10-08')).toMatchObject({ total: 4000, lucroTotal: 1500, seuLucro: 750 }))
  it('os primeiros 2.500 recebidos são capital, sem lucro', () => expect(contas(base, '2026-10-08')).toMatchObject({ capitalDeVolta: 2500, lucroRealizado: 0 }))
  it('depois do capital cada real é lucro dividido meio a meio', () => expect(contas(paga(1), '2026-10-08').lucroRealizado).toBe(250))
  it('sem indicador, o lucro é tudo o que passou do capital', () => expect(contas({ ...paga(1), pct: 0 }, '2026-10-08').lucroRealizado).toBe(500))
  it('quitada quando não falta nada; ativa enquanto falta', () => {
    expect(contas(paga(3), '2026-10-08').status).toBe('QUITADA')
    expect(contas(paga(2), '2026-10-08').status).toBe('ATIVA')
  })
  it('desconto quita sem entrar dinheiro e sai do lucro', () => {
    const c = contas({ ...base, parcelas: [{ valor: 500, desconto: 100, pago: 400, vencimento: '2026-11-01' }] }, '2026-10-08')
    expect(c).toMatchObject({ falta: 0, status: 'QUITADA' })
  })
  it('conta as atrasadas: só as abertas e vencidas', () => {
    expect(contas(base, '2026-11-02').atrasadas).toBe(1)
    expect(contas(base, '2027-02-01').atrasadas).toBe(3)
    expect(contas(paga(1), '2026-11-02').atrasadas).toBe(0)
  })
  it('retomada e cancelada mantêm o status gravado', () => expect(contas({ ...base, statusGravado: 'RETOMADA' }, '2026-10-08').status).toBe('RETOMADA'))
})
