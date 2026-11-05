import { describe, expect, it } from 'vitest'
import { alturaDoApp, type EntradaAltura } from './alturaApp'

// iPhone 17 Pro Max: tela 956, a página enxerga ~894 (sem a barra de status)
const base: EntradaAltura = { instalado: true, ios: true, emPe: true, telaAltura: 956, janelaAltura: 894 }

describe('alturaDoApp', () => {
  it('app instalado no iPhone em pé → altura da tela inteira', () => {
    expect(alturaDoApp(base)).toBe(956)
  })
  it('se a página já enxerga mais que a tela, usa a maior', () => {
    expect(alturaDoApp({ ...base, telaAltura: 900, janelaAltura: 956 })).toBe(956)
  })
  it('Safari comum, Android, computador ou deitado → não mexe (null)', () => {
    expect(alturaDoApp({ ...base, instalado: false })).toBeNull()
    expect(alturaDoApp({ ...base, ios: false })).toBeNull()
    expect(alturaDoApp({ ...base, emPe: false })).toBeNull()
  })
  it('valor inválido → null', () => {
    expect(alturaDoApp({ ...base, telaAltura: NaN, janelaAltura: NaN })).toBeNull()
    expect(alturaDoApp({ ...base, telaAltura: 0, janelaAltura: 0 })).toBeNull()
  })
})
