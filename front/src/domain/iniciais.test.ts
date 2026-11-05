import { describe, expect, it } from 'vitest'
import { iniciais } from './format'

describe('iniciais', () => {
  it.each([
    ['FRANCISCO MOREIRA DE MATO JUNIOR', 'FM'],
    ['Maria de Souza', 'MD'],
    ['ANA', 'A'],
    ['  joão   silva ', 'JS'],
    ['Ágata Ñandú', 'ÁÑ'],
  ])('%s → %s', (nome, esperado) => expect(iniciais(nome)).toBe(esperado))

  it('o apelido entre parênteses não vira inicial ("W(" e "F(" eram o defeito)', () => {
    expect(iniciais('WEVERTON (DEDA)')).toBe('W')
    expect(iniciais('FABIANO (DEDA)')).toBe('F')
    expect(iniciais('ANA SOUZA (MANA)')).toBe('AS')
    expect(iniciais('Pedro (Pepê) Lima')).toBe('PL')
    expect(iniciais('Carlos (Dudu')).toBe('C')
  })

  it('só apelido ou símbolos: usa o que tiver; vazio fica vazio', () => {
    expect(iniciais('(DEDA)')).toBe('D')
    expect(iniciais('- & 12')).toBe('')
    expect(iniciais('')).toBe('')
  })
})
