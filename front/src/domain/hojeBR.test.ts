import { describe, expect, it } from 'vitest'
import { hojeBR } from './hojeBR'

describe('hojeBR', () => {
  it('às 22h21 em Brasília (01h21 UTC do dia seguinte) ainda é o dia de Brasília', () => {
    expect(hojeBR(new Date('2026-11-04T01:21:00Z'))).toBe('2026-11-03')
  })
  it('depois da meia-noite em Brasília vira o dia', () => {
    expect(hojeBR(new Date('2026-11-04T03:00:00Z'))).toBe('2026-11-04')
  })
})
