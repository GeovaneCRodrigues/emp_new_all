import { describe, expect, it } from 'vitest'
import { documentosFaltando, tamanhoLegivel } from './documentosCliente'

describe('documentosFaltando', () => {
  it('sem nada anexado, faltam os dois obrigatórios', () => expect(documentosFaltando([])).toEqual(['CNH ou RG', 'Comprovante de residência']))
  it('tendo o comprovante, falta só o documento de identidade', () => expect(documentosFaltando([{ tipo: 'COMPROVANTE_RESIDENCIA' }])).toEqual(['CNH ou RG']))
  it('selfie e outros não contam como obrigatórios', () => expect(documentosFaltando([{ tipo: 'SELFIE' }, { tipo: 'OUTRO' }])).toHaveLength(2))
  it('completo, não falta nada', () => expect(documentosFaltando([{ tipo: 'DOC_IDENTIDADE' }, { tipo: 'COMPROVANTE_RESIDENCIA' }])).toEqual([]))
})
describe('tamanhoLegivel', () => {
  it('KB e MB', () => { expect(tamanhoLegivel(300)).toBe('1 KB'); expect(tamanhoLegivel(2048)).toBe('2 KB'); expect(tamanhoLegivel(1.5 * 1024 * 1024)).toBe('1,5 MB') })
})
