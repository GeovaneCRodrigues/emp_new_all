import { describe, expect, it } from 'vitest'
import { casaBusca, normalizarBusca } from './busca'

describe('normalizarBusca', () => {
  it('tira acento, maiúscula e espaço sobrando', () => expect(normalizarBusca('  JOÃO   da  Conceição ')).toBe('joao da conceicao'))
  it('vazio e nulo viram texto vazio', () => { expect(normalizarBusca('')).toBe(''); expect(normalizarBusca(null)).toBe(''); expect(normalizarBusca(undefined)).toBe('') })
  it('corta em 80 letras (o servidor também)', () => expect(normalizarBusca('a'.repeat(300))).toHaveLength(80))
})

describe('casaBusca', () => {
  const campos = ['JOÃO DA CONCEIÇÃO', 'IPHONE 15 PRO', 256, null, undefined]
  it('busca vazia ou só espaço acha tudo', () => { expect(casaBusca(campos, '')).toBe(true); expect(casaBusca(campos, '   ')).toBe(true); expect(casaBusca(campos, undefined)).toBe(true) })
  it('sem acento nem maiúscula', () => { expect(casaBusca(campos, 'joao')).toBe(true); expect(casaBusca(campos, 'CONCEICAO')).toBe(true) })
  it('várias palavras, em qualquer ordem, até em campos diferentes', () => {
    expect(casaBusca(campos, 'conceicao joao')).toBe(true)
    expect(casaBusca(campos, 'joao pro')).toBe(true)
    expect(casaBusca(campos, 'joao 256')).toBe(true)
  })
  it('todas as palavras têm de aparecer', () => expect(casaBusca(campos, 'joao silva')).toBe(false))
  it('campos nulos não viram a palavra "null"', () => { expect(casaBusca(campos, 'null')).toBe(false); expect(casaBusca(campos, 'undefined')).toBe(false) })
  it('% e _ valem como letra', () => { expect(casaBusca(['100% sério'], '100%')).toBe(true); expect(casaBusca(['abc'], '_')).toBe(false) })
})
