import { describe, expect, it } from 'vitest'
import { maiusculas } from './format'

describe('cadastro em letras maiúsculas', () => {
  it('tudo em maiúsculas, com acento preservado', () => { expect(maiusculas('josé da conceição')).toBe('JOSÉ DA CONCEIÇÃO'); expect(maiusculas('Ação São João')).toBe('AÇÃO SÃO JOÃO') })
  it('tira espaços das pontas e junta os do meio', () => { expect(maiusculas('  maria   da  silva ')).toBe('MARIA DA SILVA') })
  it('vazio continua vazio', () => { expect(maiusculas('   ')).toBe('') })
  it('o "ı" e o "ß" não quebram', () => { expect(() => maiusculas('straße')).not.toThrow() })
})
