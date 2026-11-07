import { describe, expect, it } from 'vitest'
import fixture from '../../../back/tests/fixtures/contratos/paridade.json'
import { MODELO_PADRAO, preencher } from './contrato'
import { paraLinhas } from './contratoLinhas'

describe('contrato em linhas (só apresentação)', () => {
  it('reconhece título, cláusula numerada, linha em branco e texto, e separa o número do resto', () => {
    const l = paraLinhas([
      { tipo: 'txt', v: 'CLÁUSULA PRIMEIRA: DO OBJETO\n1.1. O objeto é a locação de ' },
      { tipo: 'ok', v: 'iPhone 15' },
      { tipo: 'txt', v: '.\n\n14.1.1. Outra\niii) letra romana\nDATA INÍCIO: 06/11/2026' },
    ])
    expect(l.map((x) => x.tipo)).toEqual(['titulo', 'item', 'vazia', 'item', 'item', 'texto'])
    expect(l[1]).toMatchObject({ numero: '1.1.', partes: [{ tipo: 'txt', v: 'O objeto é a locação de ' }, { tipo: 'ok', v: 'iPhone 15' }, { tipo: 'txt', v: '.' }] })
    expect(l[3]).toMatchObject({ numero: '14.1.1.', partes: [{ tipo: 'txt', v: 'Outra' }] })
    expect(l[4]).toMatchObject({ numero: 'iii)' })
  })
  it('um campo no começo da linha não é tomado por número', () => {
    const l = paraLinhas([{ tipo: 'ok', v: '1.1. falso' }])
    expect(l[0]).toMatchObject({ tipo: 'texto', numero: null })
  })
  it('não muda nenhuma letra: juntando as linhas de volta dá o texto original (modelo padrão inteiro)', () => {
    const c = fixture.casos[0]!
    const p = preencher(MODELO_PADRAO, c.dados as never, c.empresa as never)
    const linhas = paraLinhas(p.trechos)
    const volta = linhas.map((x) => (x.numero ? `${x.numero} ` : '') + x.partes.map((q) => q.v).join('')).join('\n')
    expect(volta).toBe(p.texto)
    expect(linhas.filter((x) => x.tipo === 'titulo').length).toBeGreaterThan(18)
    expect(linhas.filter((x) => x.tipo === 'item').length).toBeGreaterThan(60)
  })
})
