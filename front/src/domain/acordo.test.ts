import { describe, expect, it } from 'vitest'
import { distribuirAcordo, indicadoresDiferentes, parcelasParaValor, resumoUnificacao, problemaDoAcordo, valorSugeridoAcordo, vencimentosAcordo } from './acordo'

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
  it('semanal (7 dias) e quinzenal (14 dias)', () => {
    expect(vencimentosAcordo('2026-12-01', 4, 'SEMANAL')).toEqual(['2026-12-01', '2026-12-08', '2026-12-15', '2026-12-22'])
    expect(vencimentosAcordo('2026-12-01', 4, 'QUINZENAL')).toEqual(['2026-12-01', '2026-12-15', '2026-12-29', '2027-01-12'])
  })
  it('diária de segunda a sábado: pula o domingo e uma 1ª num domingo vai para a segunda', () => {
    expect(vencimentosAcordo('2026-12-04', 4, 'DIARIA')).toEqual(['2026-12-04', '2026-12-05', '2026-12-07', '2026-12-08'])
    expect(vencimentosAcordo('2026-12-06', 3, 'DIARIA')).toEqual(['2026-12-07', '2026-12-08', '2026-12-09'])
  })
})

describe('validação da proposta', () => {
  const ok = { valorTotal: 3000, parcelas: 4, primeiraParcela: '2026-12-01' }
  it('proposta certa não tem problema', () => { expect(problemaDoAcordo(ok, '2026-11-30')).toBe('') })
  it.each([
    ['valor zero', { valorTotal: 0 }], ['valor negativo', { valorTotal: -5 }], ['parcelas zero', { parcelas: 0 }], ['parcelas quebradas', { parcelas: 2.5 }], ['parcelas demais', { parcelas: 241 }],
    ['sem data', { primeiraParcela: '' }], ['data que já passou', { primeiraParcela: '2026-11-29' }], ['data a mais de um ano', { primeiraParcela: '2027-12-02' }], ['pequeno demais', { valorTotal: 0.04, parcelas: 5 }],
  ])('recusa %s', (_n, m) => { expect(problemaDoAcordo({ ...ok, ...m }, '2026-11-30')).not.toBe('') })
  it('a data de hoje é aceita', () => { expect(problemaDoAcordo({ ...ok, primeiraParcela: '2026-11-30' }, '2026-11-30')).toBe('') })
})

describe('valorSugeridoAcordo', () => {
  it('o que devia + dinheiro novo + juros dele (Mateus: 1.600 + 1.500 + 1.500 = 4.600)', () => { expect(valorSugeridoAcordo(1600, 1500, 1500)).toBe(4600) })
  it('sem juros soma só o dinheiro novo; sem dinheiro novo devolve o saldo', () => {
    expect(valorSugeridoAcordo(1600, 1500, 0)).toBe(3100)
    expect(valorSugeridoAcordo(1600, 0, 0)).toBe(1600)
  })
  it('negativo conta como zero e arredonda no centavo', () => {
    expect(valorSugeridoAcordo(100, -5, -1)).toBe(100)
    expect(valorSugeridoAcordo(100.1, 0.2, 0.3)).toBe(100.6)
  })
})

describe('unificar empréstimos', () => {
  it('soma o que deve e o capital inteiro (o que já voltou vai junto)', () => {
    expect(resumoUnificacao([{ falta: 3720, capital: 3000 }, { falta: 4080, capital: 3000 }])).toEqual({ saldo: 7800, capital: 6000 })
    expect(resumoUnificacao([])).toEqual({ saldo: 0, capital: 0 })
    expect(resumoUnificacao([{ falta: 100 }])).toEqual({ saldo: 100, capital: 0 })
  })
  it('indicador igual herda; diferente (ou % diferente, ou um sem indicador) pede escolha', () => {
    const r = { id: 1, nome: 'Roberto' }
    expect(indicadoresDiferentes([{ indicador: r, percentualIndicador: 0.5 }, { indicador: r, percentualIndicador: 0.5 }])).toBe(false)
    expect(indicadoresDiferentes([{ indicador: r, percentualIndicador: 0.5 }, { indicador: r, percentualIndicador: 0.4 }])).toBe(true)
    expect(indicadoresDiferentes([{ indicador: r, percentualIndicador: 0.5 }, { indicador: null, percentualIndicador: 0 }])).toBe(true)
    expect(indicadoresDiferentes([{ indicador: null }, { indicador: null }])).toBe(false)
  })
})

describe('parcelas a partir do valor da parcela', () => {
  it('conta exata: 700 de 100 em 100 → 7x; 3.000 de 750 → 4x', () => { expect(parcelasParaValor(700, 100)).toBe(7); expect(parcelasParaValor(3000, 750)).toBe(4) })
  it('com resto arredonda para cima: 700 de 200 → 4x (3,5)', () => { expect(parcelasParaValor(700, 200)).toBe(4) })
  it('não se perde em centavos: 700 de 233,33 → 4x; 0,3 de 0,1 → 3x', () => { expect(parcelasParaValor(700, 233.33)).toBe(4); expect(parcelasParaValor(0.3, 0.1)).toBe(3) })
  it('parcela maior que o total → 1x', () => { expect(parcelasParaValor(500, 800)).toBe(1) })
  it('passa do limite → 240; sem total ou sem parcela → 0', () => {
    expect(parcelasParaValor(100000, 1)).toBe(240)
    expect(parcelasParaValor(0, 100)).toBe(0); expect(parcelasParaValor(500, 0)).toBe(0)
  })
})
