import { describe, expect, it } from 'vitest'
import { contasEmp, contasVenda, planoEmprestimo, planoParc, simularVenda } from './calc'
import type { Bem, Emprestimo, Parcela, Venda } from './types'

const HOJE = '2026-10-08'
const parcela = (n: number, valor: number, pago = 0): Parcela => ({
  n, venc: '2026-11-01', valor, pago: pago >= valor ? '2026-10-01' : null, desconto: 0,
  pagos: pago ? [{ data: '2026-10-01', valor: pago, forma: 'Pix', tx: n }] : [],
})
const bem = (custo: number): Bem => ({ id: 1, modelo: 'iPhone', gb: 128, cor: 'Preto', bateria: 90, cond: 'Seminovo', imei: '', custo, extras: 0, preco: 4000, estado: 'VENDIDO', desde: '2026-01-01', origem: 'COMPRA' })
const venda = (parcelas: Parcela[], entrada: number, pct: number): Venda => ({
  tipo: 'VENDA', id: 1, bemId: 1, clienteId: 1, data: '2026-10-01', entrada, troca: 0, parcelas, indicadorId: 1, pct, contrato: 'ASSINADO', status: 'ATIVA',
})

describe('juros da venda parcelada (10% por parcela, juros simples)', () => {
  // preço 7.500 − entrada 1.500 = 6.000 pra parcelar
  it.each([
    [10, 1200, 12000],
    [6, 1600, 9600],
    [5, 1800, 9000],
  ])('%ix → parcela %d (total %d)', (n, parc, total) => {
    const pl = planoParc(6000, n)
    expect(pl.parc).toBe(parc)
    expect(pl.total).toBe(total)
  })

  it('em 10x o cliente paga o dobro do valor parcelado', () => {
    expect(planoParc(6000, 10).juros).toBe(6000)
  })

  it('1x também paga os 10% (a confirmar com o Geovane)', () => {
    expect(planoParc(6000, 1).total).toBe(6600)
  })

  it('o % e o máximo são configuráveis', () => {
    expect(planoParc(1000, 4, { pct: 5, maxParcelas: 6 }).total).toBe(1200)
  })

  it('arredonda a parcela para cima no centavo e o cliente paga parcela × n (igual ao backend)', () => {
    const p = planoParc(1000, 3) // 1.300 ÷ 3 = 433,333…
    expect(p.parc).toBe(433.34)
    expect(p.total).toBe(1300.02)
  })
  it('sem parcelas não há juros', () => expect(planoParc(0, 0)).toEqual({ total: 0, parc: 0, juros: 0 }))
})

describe('lucro: o capital volta primeiro', () => {
  // custo 2.500, vendido por 4.000 no total, indicador com 50%
  const parcelas = [parcela(1, 500), parcela(2, 500), parcela(3, 500)]

  it('lucro total é 1.500 e a parte do dono, 750', () => {
    const k = contasVenda(venda(parcelas, 2500, 0.5), bem(2500), HOJE)
    expect(k.total).toBe(4000)
    expect(k.lucroTotal).toBe(1500)
    expect(k.seuLucro).toBe(750)
  })

  it('os primeiros 2.500 recebidos são capital, sem lucro', () => {
    const k = contasVenda(venda(parcelas, 2500, 0.5), bem(2500), HOJE)
    expect(k.capitalDeVolta).toBe(2500)
    expect(k.lucroRealizado).toBe(0)
  })

  it('depois do capital, cada real recebido é lucro dividido meio a meio', () => {
    const k = contasVenda(venda([parcela(1, 500, 500), parcela(2, 500), parcela(3, 500)], 2500, 0.5), bem(2500), HOJE)
    expect(k.lucroRealizado).toBe(250)
  })

  it('sem indicador, o lucro é tudo o que passou do capital', () => {
    const k = contasVenda(venda([parcela(1, 500, 500), parcela(2, 500), parcela(3, 500)], 2500, 0), bem(2500), HOJE)
    expect(k.lucroRealizado).toBe(500)
  })

  it('o % congelado na operação não muda com o indicador', () => {
    // recebido 3.000 − capital 2.500 = 500 de lucro; com 30% pro indicador, sobram 350
    const v = venda([parcela(1, 500, 500)], 2500, 0.3)
    expect(contasVenda(v, bem(2500), HOJE).lucroRealizado).toBe(350)
  })
})

describe('simularVenda', () => {
  it('mostra juros, total, parte do indicador, lucro e onde o capital volta', () => {
    const r = simularVenda({ preco: 7500, entrada: 1500, troca: 0, n: 10, investido: 5000, pctIndicador: 0.5 })
    expect(r.parcelado).toBe(6000)
    expect(r.parc).toBe(1200)
    expect(r.total).toBe(13500)
    expect(r.lucro).toBe(8500)
    expect(r.parteIndicador).toBe(4250)
    expect(r.seuLucro).toBe(4250)
    expect(r.volta).toBe(3) // 1.500 + 3×1.200 = 5.100 ≥ 5.000
  })

  it('a troca também entra como abatimento do parcelado', () => {
    expect(simularVenda({ preco: 7500, entrada: 1500, troca: 1000, n: 5, investido: 0, pctIndicador: 0 }).parcelado).toBe(5000)
  })
})

describe('empréstimo', () => {
  it('parcelado: juro em % NO TOTAL — 3.000 a 30% em 6x são 6 × 650,00 (exemplo do plano)', () => {
    const plano = planoEmprestimo({ capital: 3000, mod: 'PARCELADO', taxa: 30, n: 6, data: '2026-10-08' })
    expect(plano.every((p) => p.valor === 650)).toBe(true)
  })
  it('parcelado: 5.000 a 60% em 6x são 6 × 1.333,34 (os 10% ao mês de antes × 6)', () => {
    const plano = planoEmprestimo({ capital: 5000, mod: 'PARCELADO', taxa: 60, n: 6, data: '2026-06-25' })
    expect(plano.every((p) => p.valor === 1333.34)).toBe(true)
    expect(plano[0].venc).toBe('2026-07-25')
  })
  it('exemplos do plano: 6.000 de total = 100%; parcela de 700 em 6x = 4.200 = 40%', () => {
    expect(planoEmprestimo({ capital: 3000, mod: 'PARCELADO', taxa: 100, n: 6, data: '2026-10-08' })[0].valor).toBe(1000)
    expect(planoEmprestimo({ capital: 3000, mod: 'PARCELADO', taxa: 40, n: 6, data: '2026-10-08' })[0].valor).toBe(700)
  })
  it('só juros: capital na última parcela', () => {
    const plano = planoEmprestimo({ capital: 3000, mod: 'JUROS', taxa: 12, n: 3, data: '2026-05-10' })
    expect(plano.map((p) => p.valor)).toEqual([360, 360, 3360])
  })
  it('só juros, 1.000 a 10% em 6x semanal: 5x de 100,00 e a última de 1.100,00 (exemplo do plano)', () => {
    const plano = planoEmprestimo({ capital: 1000, mod: 'JUROS', taxa: 10, n: 6, data: '2026-10-08', freq: 'SEMANAL' })
    expect(plano.map((p) => p.valor)).toEqual([100, 100, 100, 100, 100, 1100])
  })
  it('semanal com 1º vencimento em 15/10: 15/10, 22/10, 29/10…', () => {
    const plano = planoEmprestimo({ capital: 1000, mod: 'PARCELADO', taxa: 30, n: 3, data: '2026-10-08', freq: 'SEMANAL', primeira: '2026-10-15' })
    expect(plano.map((p) => p.venc)).toEqual(['2026-10-15', '2026-10-22', '2026-10-29'])
  })
  it('quinzenal: de 15 em 15 dias; sem 1º vencimento, um período depois', () => {
    expect(planoEmprestimo({ capital: 1000, mod: 'PARCELADO', taxa: 30, n: 3, data: '2026-10-08', freq: 'QUINZENAL' }).map((p) => p.venc)).toEqual(['2026-10-23', '2026-11-07', '2026-11-22'])
  })
  it('dia 31: sem 1º vencimento escolhido volta a 31; escolhido vale o dia dele', () => {
    expect(planoEmprestimo({ capital: 1000, mod: 'PARCELADO', taxa: 30, n: 3, data: '2026-01-31' }).map((p) => p.venc)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30'])
    expect(planoEmprestimo({ capital: 1000, mod: 'PARCELADO', taxa: 30, n: 3, data: '2026-01-31', primeira: '2026-02-28' }).map((p) => p.venc)).toEqual(['2026-02-28', '2026-03-28', '2026-04-28'])
  })
  it('diária: pula domingo; taxa no total (1.000 a 20% em 24x = 50,00)', () => {
    const plano = planoEmprestimo({ capital: 1000, mod: 'DIARIA', taxa: 20, n: 3, data: '2026-10-03' }) // sábado
    expect(plano.map((p) => p.venc)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07'])
    expect(planoEmprestimo({ capital: 1000, mod: 'DIARIA', taxa: 20, n: 24, data: '2026-09-24' }).every((p) => p.valor === 50)).toBe(true)
  })
  it('diária: 1º vencimento num domingo vai para a segunda', () => {
    expect(planoEmprestimo({ capital: 100, mod: 'DIARIA', taxa: 10, n: 2, data: '2026-10-01', primeira: '2026-10-04' }).map((p) => p.venc)).toEqual(['2026-10-05', '2026-10-06'])
  })
  it('contas do empréstimo usam o capital como investido', () => {
    const e: Emprestimo = { tipo: 'EMP', id: 2, clienteId: 1, data: '2026-10-01', capital: 1000, mod: 'PARCELADO', taxa: 10, freq: 'MENSAL', parcelas: [parcela(1, 550, 550), parcela(2, 550)], indicadorId: 0, pct: 0, status: 'ATIVA' }
    const k = contasEmp(e, HOJE)
    expect(k.lucroTotal).toBe(100)
    expect(k.capitalDeVolta).toBe(550)
    expect(k.lucroRealizado).toBe(0)
  })
})
