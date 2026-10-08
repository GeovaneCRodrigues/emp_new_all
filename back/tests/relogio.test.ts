import { describe, expect, it } from 'vitest'
import { somaMes } from '../src/shared/datas.js'
import { hojeBR } from '../src/shared/relogio.js'

describe('hojeBR', () => {
  it('à noite no Brasil ainda é o mesmo dia, mesmo que em UTC já seja o dia seguinte', () => {
    expect(hojeBR(new Date('2026-10-09T01:30:00Z'))).toBe('2026-10-08') // 22h30 em São Paulo
    expect(hojeBR(new Date('2026-10-09T03:00:00Z'))).toBe('2026-10-09') // meia-noite em São Paulo
  })
})

describe('somaMes', () => {
  it('soma meses e fixa o dia', () => expect(somaMes('2026-10-08', 1, 10)).toBe('2026-11-10'))
  it('limita ao último dia do mês', () => {
    expect(somaMes('2026-01-15', 1, 31)).toBe('2026-02-28')
    expect(somaMes('2028-01-15', 1, 31)).toBe('2028-02-29') // bissexto
    expect(somaMes('2026-10-08', 6, 30)).toBe('2027-04-30')
  })
  it('vira o ano', () => expect(somaMes('2026-11-20', 3, 5)).toBe('2027-02-05'))
})
