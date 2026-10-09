import { describe, expect, it } from 'vitest'
import { montarCarteira, noFiltro, semAcento, type OperacaoCarteira } from './carteira'

const op = (o: Partial<OperacaoCarteira> & { id: number; clienteId: number }): OperacaoCarteira => ({ tipo: 'VENDA', descricao: 'iPhone', status: 'ATIVA', falta: 0, atrasadas: 0, ...o })
const clientes = [{ id: 1, nome: 'Ana' }, { id: 2, nome: 'Bruno' }, { id: 3, nome: 'Carla' }, { id: 4, nome: 'Davi' }]

describe('carteira do cobrador', () => {
  const ops = [
    op({ id: 1, clienteId: 1, falta: 800, atrasadas: 2 }),
    op({ id: 2, clienteId: 1, tipo: 'EMPRESTIMO', falta: 300, atrasadas: 0 }),
    op({ id: 3, clienteId: 2, falta: 500 }),
    op({ id: 4, clienteId: 3, status: 'QUITADA', falta: 0 }),
    op({ id: 5, clienteId: 3, status: 'RETOMADA', falta: 900, atrasadas: 3 }), // retomada não conta
  ]
  const carteira = montarCarteira(clientes, ops)
  const de = (id: number) => carteira.find((c) => c.cliente.id === id)!

  it('soma vendas e empréstimos do mesmo cliente', () => {
    expect(de(1)).toMatchObject({ saldo: 1100, atrasadas: 2, situacao: 'ATRASO' })
    expect(de(1).operacoes).toHaveLength(2)
  })
  it('em dia = deve e nada atrasado; sem dívida = nada em aberto', () => {
    expect(de(2)).toMatchObject({ saldo: 500, atrasadas: 0, situacao: 'EM_DIA' })
    expect(de(4)).toMatchObject({ saldo: 0, situacao: 'SEM_DIVIDA' })
  })
  it('venda retomada e operação quitada não entram na conta do cliente', () => {
    expect(de(3)).toMatchObject({ saldo: 0, atrasadas: 0, situacao: 'SEM_DIVIDA' })
    expect(de(3).operacoes).toHaveLength(2) // continuam na ficha dele, só não contam
  })
  it('ordem: mais atrasadas primeiro, depois maior saldo, depois nome', () => {
    expect(carteira.map((c) => c.cliente.nome)).toEqual(['Ana', 'Bruno', 'Carla', 'Davi'])
  })
  it('filtros: todos, atrasados, em dia', () => {
    expect(carteira.filter((c) => noFiltro(c, 'TODOS'))).toHaveLength(4)
    expect(carteira.filter((c) => noFiltro(c, 'ATRASO')).map((c) => c.cliente.nome)).toEqual(['Ana'])
    expect(carteira.filter((c) => noFiltro(c, 'EM_DIA')).map((c) => c.cliente.nome)).toEqual(['Bruno'])
  })
  it('carteira vazia e cliente sem operação não quebram', () => {
    expect(montarCarteira([], ops)).toEqual([])
    expect(montarCarteira([{ id: 9, nome: 'Zé' }], [])[0]).toMatchObject({ saldo: 0, situacao: 'SEM_DIVIDA', operacoes: [] })
  })
  it('a busca ignora acento e maiúscula', () => {
    expect(semAcento('José Conceição')).toBe('jose conceicao')
  })
})
