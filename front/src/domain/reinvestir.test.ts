import { describe, expect, it } from 'vitest'
import { PERDAS_PADRAO } from './previsao'
import { lerRetirada, projetarReinvestir, RETIRADA_PADRAO, type DadosReinvestir } from './reinvestir'

const dados: DadosReinvestir = {
  meses: ['2026-08', '2026-09', '2026-10'], lucroPorMes: [1000, 500, 250],
  previsto: { atraso: { ate7: 100, de8a30: 100, mais30: 100 }, porMes: [{ mes: '2026-10', lucro: 200 }, { mes: '2026-11', lucro: 400 }], depois: 1000 },
}
const zero = { aVencer: 0, ate7: 0, de8a30: 0, mais30: 0 }

describe('reinvestir', () => {
  it('10% do lucro fica com você, o resto reinveste, e o acumulado soma o reinvestir', () => {
    const r = projetarReinvestir(dados, zero, 1, 0.1)
    expect(r.realizado.map((l) => [l.lucro, l.retirada, l.reinvestir, l.acumulado])).toEqual([[1000, 100, 900, 900], [500, 50, 450, 1350], [250, 25, 225, 1575]])
    expect(r.totalRealizado).toEqual({ lucro: 1750, retirada: 175, reinvestir: 1575 })
  })
  it('sem perda, o mês atual leva o atraso e o a vencer', () => {
    const r = projetarReinvestir(dados, zero, 1, 0.1)
    expect(r.previsto.map((l) => l.lucro)).toEqual([500, 400])
    expect(r.depois).toBe(1000)
  })
  it('cada grupo perde a sua fatia; o pessimista dobra e o otimista corta pela metade', () => {
    const p = { aVencer: 0.1, ate7: 0.1, de8a30: 0.3, mais30: 0.7 }
    expect(projetarReinvestir(dados, p, 1, 0.1).previsto.map((l) => l.lucro)).toEqual([180 + 90 + 70 + 30, 360])
    expect(projetarReinvestir(dados, p, 2, 0.1).previsto[1].lucro).toBe(320)
    expect(projetarReinvestir(dados, p, 0.5, 0.1).previsto[1].lucro).toBe(380)
  })
  it('a retirada é editável e vai de 0 a 100%', () => {
    expect(projetarReinvestir(dados, zero, 1, 0).totalPrevisto.retirada).toBe(0)
    expect(projetarReinvestir(dados, zero, 1, 1).totalPrevisto.reinvestir).toBe(0)
  })
  it('padrão de perdas é usado sem erro e a % salva ruim volta a 10%', () => {
    expect(projetarReinvestir(dados, PERDAS_PADRAO, 1, 0.1).previsto).toHaveLength(2)
    expect([lerRetirada(0.25), lerRetirada(2), lerRetirada(-1), lerRetirada('x'), lerRetirada(null), lerRetirada(0)]).toEqual([0.25, RETIRADA_PADRAO, RETIRADA_PADRAO, RETIRADA_PADRAO, RETIRADA_PADRAO, 0])
  })
})
