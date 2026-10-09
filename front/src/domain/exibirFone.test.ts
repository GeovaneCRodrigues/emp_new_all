import { describe, expect, it } from 'vitest'
import { exibirFone } from './documentos'

describe('telefone na tela', () => {
  it('formata quando há telefone', () => { expect(exibirFone('11988124410')).toBe('(11) 98812-4410'); expect(exibirFone('1133334444')).toBe('(11) 3333-4444') })
  it('cliente trazido do sistema antigo sem telefone: "sem telefone" (vazio, nulo, espaços ou só símbolos)', () => {
    for (const v of ['', '   ', null, undefined, '()-']) expect(exibirFone(v as never)).toBe('sem telefone')
  })
})
