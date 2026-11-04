import { describe, expect, it } from 'vitest'
import { tempoRelativo } from './tempoRelativo'

const AGORA = new Date('2026-11-06T15:00:00.000Z')
const antes = (min: number) => new Date(AGORA.getTime() - min * 60_000).toISOString()

describe('tempoRelativo', () => {
  it.each([[0, 'agora'], [0.5, 'agora'], [1, 'há 1 min'], [59, 'há 59 min'], [60, 'há 1 h'], [23 * 60 + 59, 'há 23 h'], [24 * 60, 'ontem'], [47 * 60, 'ontem']])('%s min atrás → %s', (min, esperado) => {
    expect(tempoRelativo(antes(min), AGORA)).toBe(esperado)
  })
  it('depois de dois dias mostra o dia', () => {
    const iso = new Date(2026, 10, 3, 12, 0).toISOString()
    expect(tempoRelativo(iso, new Date(2026, 10, 6, 12, 0))).toBe('03/11')
  })
  it('data inválida não quebra', () => { expect(tempoRelativo('lixo', AGORA)).toBe('') })
  it('um instante no futuro (relógio adiantado) vira "agora"', () => { expect(tempoRelativo(antes(-5), AGORA)).toBe('agora') })
})
