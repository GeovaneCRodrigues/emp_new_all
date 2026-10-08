import { describe, expect, it } from 'vitest'
import { cpfValido, normalizarFone, soDigitos } from '../src/shared/documentos.js'

describe('cpfValido', () => {
  it.each(['529.982.247-25', '52998224725', '111.444.777-35'])('aceita %s', (c) => expect(cpfValido(c)).toBe(true))
  it.each(['529.982.247-24', '111.111.111-11', '000.000.000-00', '123', '', '5299822472500', 'abc'])('recusa %s', (c) => expect(cpfValido(c)).toBe(false))
})

describe('normalizarFone', () => {
  it.each([
    ['(11) 98812-4410', '11988124410'],
    ['11988124410', '11988124410'],
    ['+55 11 98812-4410', '11988124410'],
    ['(11) 3322-1100', '1133221100'],
    ['5511988124410', '11988124410'],
  ])('%s → %s', (entrada, saida) => expect(normalizarFone(entrada)).toBe(saida))
  it.each(['', '123', '(11) 88812-4410', '(01) 98812-4410', '98812-4410', '119881244100'])('recusa "%s"', (t) => expect(normalizarFone(t)).toBeNull())
  it('soDigitos', () => expect(soDigitos('(11) 9-8812')).toBe('1198812'))
})
