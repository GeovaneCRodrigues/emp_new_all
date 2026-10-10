import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { camposDesconhecidos, MODELO_PADRAO, preencher, VARIAVEIS } from './contrato'

describe('contrato (cópia do modelo do backend)', () => {
  const f = JSON.parse(readFileSync(new URL('../../../back/tests/fixtures/contratos/paridade.json', import.meta.url), 'utf8'))
  it('os campos oferecidos são os mesmos do backend', () => { expect(VARIAVEIS).toEqual(f.variaveis) })
  for (const c of f.casos) it(`dá o mesmo texto que o backend: ${c.nome}`, () => { expect(preencher(MODELO_PADRAO, c.dados, c.empresa)).toEqual(c.esperado) })
  it('dá o mesmo resultado com campo desconhecido e espaços nas chaves', () => { expect(preencher(f.extra.texto, f.extra.dados, f.extra.empresa)).toEqual(f.extra.esperado) })
  it('o modelo padrão só usa campos que existem', () => { expect(camposDesconhecidos(MODELO_PADRAO)).toEqual([]) })
})
