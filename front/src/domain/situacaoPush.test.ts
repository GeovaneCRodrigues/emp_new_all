import { describe, expect, it } from 'vitest'
import { situacaoPush, type EntradaPush } from './situacaoPush'

const base: EntradaPush = { suportado: true, servidorLigado: true, ios: false, instalado: false, permissao: 'default', inscrito: false }

describe('situacaoPush', () => {
  it('navegador sem suporte (ou demonstração) → indisponível', () => {
    expect(situacaoPush({ ...base, suportado: false })).toBe('indisponivel')
  })
  it('iPhone no Safari, sem instalar → pede para instalar, mesmo sem suporte do navegador ali', () => {
    expect(situacaoPush({ ...base, ios: true, suportado: false })).toBe('instalar')
    expect(situacaoPush({ ...base, ios: true })).toBe('instalar')
  })
  it('iPhone com o app instalado segue o fluxo normal', () => {
    expect(situacaoPush({ ...base, ios: true, instalado: true })).toBe('desativado')
  })
  it('servidor sem as chaves → desligado', () => {
    expect(situacaoPush({ ...base, servidorLigado: false })).toBe('servidor-desligado')
  })
  it('permissão negada → bloqueado (só nos ajustes do aparelho)', () => {
    expect(situacaoPush({ ...base, permissao: 'denied' })).toBe('bloqueado')
    expect(situacaoPush({ ...base, permissao: 'denied', inscrito: true })).toBe('bloqueado')
  })
  it('liberado e inscrito → ativo; liberado sem inscrição → desativado', () => {
    expect(situacaoPush({ ...base, permissao: 'granted', inscrito: true })).toBe('ativo')
    expect(situacaoPush({ ...base, permissao: 'granted' })).toBe('desativado')
    expect(situacaoPush(base)).toBe('desativado')
  })
})
