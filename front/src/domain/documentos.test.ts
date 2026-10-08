import { describe, expect, it } from 'vitest'
import { cpfValido, mascaraCpf, mascaraFone, normalizarFone } from './documentos'

describe('cpfValido', () => {
  it.each(['529.982.247-25', '52998224725', '111.444.777-35'])('aceita %s', (c) => expect(cpfValido(c)).toBe(true))
  it.each(['529.982.247-24', '111.111.111-11', '', '123'])('recusa "%s"', (c) => expect(cpfValido(c)).toBe(false))
})

describe('normalizarFone', () => {
  it.each([['(11) 98812-4410', '11988124410'], ['+55 11 98812-4410', '11988124410'], ['(11) 3322-1100', '1133221100']])('%s', (e, s) => expect(normalizarFone(e)).toBe(s))
  it.each(['', '123', '(11) 88812-4410', '(01) 98812-4410'])('recusa "%s"', (t) => expect(normalizarFone(t)).toBeNull())
})

describe('máscaras', () => {
  it.each([['5', '5'], ['5299', '529.9'], ['529982', '529.982'], ['5299822', '529.982.2'], ['52998224725', '529.982.247-25'], ['529982247259999', '529.982.247-25'], ['abc', '']])('CPF %s → %s', (e, s) => expect(mascaraCpf(e)).toBe(s))
  it.each([['', ''], ['1', '(1'], ['11', '(11'], ['119', '(11) 9'], ['1198812', '(11) 9881-2'], ['11988124410', '(11) 98812-4410'], ['1133221100', '(11) 3322-1100'], ['+5511988124410', '(11) 98812-4410']])('fone %s → %s', (e, s) => expect(mascaraFone(e)).toBe(s))
})
