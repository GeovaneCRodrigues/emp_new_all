import { describe, expect, it } from 'vitest'
import { nivelDe, validarNiveis } from '../src/modules/indicadores/services/niveis.js'

const N = [
  { id: 'BRONZE', nome: 'Bronze', minOperacoes: 0, pct: 0.3 },
  { id: 'PRATA', nome: 'Prata', minOperacoes: 3, pct: 0.4 },
  { id: 'OURO', nome: 'Ouro', minOperacoes: 5, pct: 0.5 },
  { id: 'DIAMANTE', nome: 'Diamante', minOperacoes: 10, pct: 0.55 },
]

describe('nivelDe', () => {
  it.each([[0, 'Bronze'], [2, 'Bronze'], [3, 'Prata'], [4, 'Prata'], [5, 'Ouro'], [9, 'Ouro'], [10, 'Diamante'], [99, 'Diamante']])('%i operações → %s', (n, nome) => expect(nivelDe(n, N).atual.nome).toBe(nome))
  it('sabe o próximo nível, e o último não tem', () => {
    expect(nivelDe(4, N).proximo?.nome).toBe('Ouro')
    expect(nivelDe(10, N).proximo).toBeNull()
  })
})

describe('validarNiveis', () => {
  it('aceita a tabela padrão', () => expect(validarNiveis(N)).toBeNull())
  it('o primeiro nível começa em 0', () => expect(validarNiveis([{ ...N[0], minOperacoes: 1 }, N[1]])).toMatch(/começar em 0/))
  it('os mínimos precisam crescer', () => expect(validarNiveis([N[0], N[1], { ...N[2], minOperacoes: 3 }])).toMatch(/depois do nível anterior/))
  it('nível de cima não ganha menos', () => expect(validarNiveis([N[0], { ...N[1], pct: 0.2 }])).toMatch(/não pode ganhar menos/))
  it.each([0, -0.1, 1.2, NaN])('recusa % inválido (%s)', (pct) => expect(validarNiveis([{ ...N[0], pct }])).toMatch(/entre 0 e 100/))
  it('recusa mínimo quebrado e lista vazia', () => {
    expect(validarNiveis([N[0], { ...N[1], minOperacoes: 2.5 }])).toMatch(/inteiro/)
    expect(validarNiveis([])).toMatch(/Informe/)
  })
})
