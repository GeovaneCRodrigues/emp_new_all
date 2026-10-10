import { describe, expect, it } from 'vitest'
import { gbTxt } from './format'

describe('gbTxt', () => {
  it('mostra a capacidade quando se sabe', () => { expect(gbTxt(128)).toBe('128 GB'); expect(gbTxt(1024)).toBe('1024 GB') })
  it('some quando não foi informada (aparelho migrado do sistema antigo)', () => { expect(gbTxt(0)).toBe(''); expect(gbTxt(-1)).toBe('') })
})
