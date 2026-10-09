import { describe, expect, it } from 'vitest'
import { distribuirAcordo, problemaDoAcordo, vencimentosAcordo } from './acordo'

describe('divisão do acordo', () => {
  it('a soma fecha no centavo: 1.000,01 em 3x → 333,33 + 333,33 + 333,35', () => {
    const v = distribuirAcordo(1000.01, 3)
    expect(v).toEqual([333.33, 333.33, 333.35])
    expect(Math.round(v.reduce((s, x) => s + x, 0) * 100) / 100).toBe(1000.01)
  })
  it('divide igual quando dá: 3.000 em 4x → 4 × 750', () => { expect(distribuirAcordo(3000, 4)).toEqual([750, 750, 750, 750]) })
  it('1 parcela só leva tudo', () => { expect(distribuirAcordo(3020, 1)).toEqual([3020]) })
  it('sem valor ou sem parcelas não gera nada', () => { expect(distribuirAcordo(0, 3)).toEqual([]); expect(distribuirAcordo(100, 0)).toEqual([]) })
})

describe('datas do acordo', () => {
  it('mês a mês no dia da 1ª parcela; dia 31 cai no fim dos meses curtos', () => {
    expect(vencimentosAcordo('2026-12-01', 4)).toEqual(['2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01'])
    expect(vencimentosAcordo('2026-12-31', 3)).toEqual(['2026-12-31', '2027-01-31', '2027-02-28'])
  })
})

describe('validação da proposta', () => {
  const ok = { valorTotal: 3000, parcelas: 4, primeiraParcela: '2026-12-01' }
  it('proposta certa não tem problema', () => { expect(problemaDoAcordo(ok, '2026-11-30')).toBe('') })
  it.each([
    ['valor zero', { valorTotal: 0 }], ['valor negativo', { valorTotal: -5 }], ['parcelas zero', { parcelas: 0 }], ['parcelas quebradas', { parcelas: 2.5 }], ['parcelas demais', { parcelas: 121 }],
    ['sem data', { primeiraParcela: '' }], ['data que já passou', { primeiraParcela: '2026-11-29' }], ['data a mais de um ano', { primeiraParcela: '2027-12-02' }], ['pequeno demais', { valorTotal: 0.04, parcelas: 5 }],
  ])('recusa %s', (_n, m) => { expect(problemaDoAcordo({ ...ok, ...m }, '2026-11-30')).not.toBe('') })
  it('a data de hoje é aceita', () => { expect(problemaDoAcordo({ ...ok, primeiraParcela: '2026-11-30' }, '2026-11-30')).toBe('') })
})
