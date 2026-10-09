import { describe, expect, it } from 'vitest'
import { nomeEmprestimo, pctDaParcela, pctDoJuro, pctDoTotal, taxaTexto } from './emprestimo'

describe('nomes e textos do empréstimo', () => {
  it('a frequência só aparece quando não é mensal; a diária já é diária', () => {
    expect(nomeEmprestimo('PARCELADO', 'MENSAL')).toBe('Empréstimo parcelado')
    expect(nomeEmprestimo('PARCELADO', 'QUINZENAL')).toBe('Empréstimo parcelado quinzenal')
    expect(nomeEmprestimo('JUROS', 'SEMANAL')).toBe('Empréstimo só juros semanal')
    expect(nomeEmprestimo('DIARIA', 'DIARIA')).toBe('Empréstimo diária')
  })
  it('taxa: "no total" no parcelado e na diária; "por mês/semana" no só juros', () => {
    expect(taxaTexto('PARCELADO', 'MENSAL', 60)).toBe('60% no total')
    expect(taxaTexto('DIARIA', 'DIARIA', 20)).toBe('20% no total')
    expect(taxaTexto('JUROS', 'MENSAL', 12)).toBe('12% por mês')
    expect(taxaTexto('JUROS', 'SEMANAL', 7.5)).toBe('7,5% por semana')
  })
})

describe('os campos se ajustam entre si (exemplos do plano)', () => {
  it('digitar 6.000 de total para 3.000 de capital vira 100%', () => { expect(pctDoTotal(3000, 6000)).toBe(100) })
  it('digitar parcela de 700 em 6x para 3.000 vira total 4.200 e 40%', () => { expect(pctDaParcela(3000, 700, 6)).toBe(40) })
  it('3.900 de total para 3.000 vira 30%', () => { expect(pctDoTotal(3000, 3900)).toBe(30) })
  it('só juros: juro de 100 sobre 1.000 vira 10%', () => { expect(pctDoJuro(1000, 100)).toBe(10) })
  it('sem capital não calcula (0%)', () => { expect(pctDoTotal(0, 100)).toBe(0); expect(pctDoJuro(0, 10)).toBe(0) })
  it('% quebrado mantém 4 casas: parcela de 701 em 6x para 3.000 = 40,2%', () => { expect(pctDaParcela(3000, 701, 6)).toBe(40.2) })
})
