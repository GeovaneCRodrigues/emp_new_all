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
  it('parcelado: juros simples ao mês sobre o capital', () => {
    const plano = planoEmprestimo({ capital: 5000, mod: 'PARCELADO', taxa: 10, n: 6, data: '2026-06-25' })
    expect(plano.every((p) => p.valor === 1333.34)).toBe(true) // 5000 × 1,6 ÷ 6
  })
  it('só juros: capital na última parcela', () => {
    const plano = planoEmprestimo({ capital: 3000, mod: 'JUROS', taxa: 12, n: 3, data: '2026-05-10' })
    expect(plano.map((p) => p.valor)).toEqual([360, 360, 3360])
  })
  it('diária: pula domingo', () => {
    const plano = planoEmprestimo({ capital: 1000, mod: 'DIARIA', taxa: 20, n: 3, data: '2026-10-03' }) // sábado
    expect(plano.map((p) => p.venc)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07'])
  })
  it('contas do empréstimo usam o capital como investido', () => {
    const e: Emprestimo = { tipo: 'EMP', id: 2, clienteId: 1, data: '2026-10-01', capital: 1000, mod: 'PARCELADO', taxa: 10, parcelas: [parcela(1, 550, 550), parcela(2, 550)], indicadorId: 0, pct: 0, status: 'ATIVA' }
    const k = contasEmp(e, HOJE)
    expect(k.lucroTotal).toBe(100)
    expect(k.capitalDeVolta).toBe(550)
    expect(k.lucroRealizado).toBe(0)
  })
})
