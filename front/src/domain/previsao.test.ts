import { describe, expect, it } from 'vitest'
import { cenario, CENARIOS, lerPerdas, PERDAS_PADRAO, perdaNoCenario, type Previsao } from './previsao'

const prev = (o: Partial<Previsao> = {}): Previsao => ({
  caixa: 1000, estoque: 500, repassesAPagar: 100, parteIndicadores: 400,
  atraso: { ate7: { n: 2, valor: 1000 }, de8a30: { n: 1, valor: 1000 }, mais30: { n: 1, valor: 1000 } }, aVencer: { n: 5, valor: 7000 },
  porMes: [{ mes: '2026-10', valor: 3000 }, { mes: '2026-11', valor: 4000 }], ...o,
})
const real = CENARIOS.find((c) => c.id === 'realista')!.fator

describe('previsão: cenários', () => {
  it('realista: aplica a perda de cada grupo e desconta a parte dos indicadores na mesma proporção', () => {
    const c = cenario(prev(), PERDAS_PADRAO, real)
    expect(c.recuperadoAtraso).toBe(900 + 700 + 300) // 1000 × (0,9 + 0,7 + 0,3)
    expect(c.recuperadoAVencer).toBe(6650) // 7000 × 0,95
    expect(c.recuperado).toBe(8550); expect(c.devido).toBe(10000); expect(c.perdido).toBe(1450)
    expect(c.indicadores).toBe(342) // 400 × 8550 / 10000
    expect(c.naMao).toBe(1000 + 8550 - 342 - 100)
  })
  it('pessimista dobra as perdas e otimista corta pela metade; a ordem é sempre pessimista ≤ realista ≤ otimista', () => {
    const [pess, rea, otim] = CENARIOS.map((c) => cenario(prev(), PERDAS_PADRAO, c.fator).naMao)
    expect(pess).toBeLessThan(rea); expect(rea).toBeLessThan(otim)
    expect(cenario(prev(), PERDAS_PADRAO, 2).recuperadoAVencer).toBe(6300) // perda de 10%
    expect(cenario(prev(), PERDAS_PADRAO, 0.5).recuperadoAVencer).toBe(6825) // perda de 2,5%
  })
  it('a perda nunca passa de 100%: 70% dobrado vira tudo perdido, não negativo', () => {
    expect(perdaNoCenario(0.7, 2)).toBe(1); expect(perdaNoCenario(-0.2, 1)).toBe(0); expect(perdaNoCenario(Number.NaN, 1)).toBe(0)
    expect(cenario(prev(), PERDAS_PADRAO, 2).recuperadoAtraso).toBe(800 + 400 + 0)
  })
  it('sem perda nenhuma, recebe tudo e só os indicadores e os repasses saem; perda total deixa só o caixa menos os repasses', () => {
    const zero = { aVencer: 0, ate7: 0, de8a30: 0, mais30: 0 }, tudo = { aVencer: 1, ate7: 1, de8a30: 1, mais30: 1 }
    expect(cenario(prev(), zero, real)).toMatchObject({ recuperado: 10000, perdido: 0, indicadores: 400, naMao: 1000 + 10000 - 400 - 100 })
    expect(cenario(prev(), tudo, real)).toMatchObject({ recuperado: 0, indicadores: 0, naMao: 900 })
  })
  it('nada em aberto não divide por zero', () => {
    const vazio = prev({ atraso: { ate7: { n: 0, valor: 0 }, de8a30: { n: 0, valor: 0 }, mais30: { n: 0, valor: 0 } }, aVencer: { n: 0, valor: 0 }, porMes: [] })
    expect(cenario(vazio, PERDAS_PADRAO, real)).toMatchObject({ devido: 0, indicadores: 0, naMao: 900 })
  })
  it('mês a mês: o esperado usa a perda do "a vencer"', () => {
    expect(cenario(prev(), PERDAS_PADRAO, real).porMes).toEqual([{ mes: '2026-10', valor: 3000, esperado: 2850 }, { mes: '2026-11', valor: 4000, esperado: 3800 }])
  })
  it('caixa negativo continua negativo na conta (não some)', () => {
    expect(cenario(prev({ caixa: -500 }), PERDAS_PADRAO, real).naMao).toBe(-500 + 8550 - 342 - 100)
  })
})

describe('previsão: percentuais salvos', () => {
  it('usa o salvo quando é válido e o padrão do campo quando não é', () => {
    expect(lerPerdas({ aVencer: 0.1, ate7: 0.2, de8a30: 0.4, mais30: 0.9 })).toEqual({ aVencer: 0.1, ate7: 0.2, de8a30: 0.4, mais30: 0.9 })
    expect(lerPerdas({ aVencer: 2, ate7: -1, de8a30: 'x', mais30: Number.NaN })).toEqual(PERDAS_PADRAO)
    expect(lerPerdas({ aVencer: 0 }).aVencer).toBe(0) // zero é válido
  })
  it('lixo, nulo e texto voltam ao padrão', () => {
    for (const v of [null, undefined, 'abc', 5, []]) expect(lerPerdas(v)).toEqual(PERDAS_PADRAO)
  })
})
