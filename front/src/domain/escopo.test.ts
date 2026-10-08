import { describe, expect, it } from 'vitest'
import { criarSeed } from '@/data/seed'
import { aplicarEscopo } from './escopo'

const d = criarSeed()

describe('escopo por perfil', () => {
  it('admin vê tudo, com custo', () => {
    const r = aplicarEscopo(d, { perfil: 'ADMIN', usuarioId: 1 })
    expect(r.vendas).toHaveLength(d.vendas.length)
    expect(r.bens.some((b) => b.custo > 0)).toBe(true)
  })

  it('vendedor: nenhum aparelho traz custo, e só vê os clientes dele', () => {
    const r = aplicarEscopo(d, { perfil: 'VENDEDOR', usuarioId: 2 })
    expect(r.bens.length).toBe(d.bens.length)
    expect(r.bens.every((b) => b.custo === 0 && b.extras === 0)).toBe(true)
    expect(r.clientes.every((c) => c.responsavelId === 2)).toBe(true)
    expect(r.emprestimos).toHaveLength(0)
    expect(r.repasses).toHaveLength(0)
  })

  it('cobrador: só a carteira dele, sem estoque da loja nem custo', () => {
    const r = aplicarEscopo(d, { perfil: 'COBRADOR', usuarioId: 3 })
    const meus = new Set(d.clientes.filter((c) => c.responsavelId === 3).map((c) => c.id))
    expect([...r.vendas, ...r.emprestimos].every((o) => meus.has(o.clienteId))).toBe(true)
    expect(r.bens.every((b) => b.custo === 0)).toBe(true)
    expect(r.bens.length).toBeLessThan(d.bens.length)
  })

  it('indicador: só o que ele indicou, nenhum cliente de outro indicador', () => {
    const r = aplicarEscopo(d, { perfil: 'INDICADOR', indicadorId: 2 })
    expect(r.vendas.map((v) => v.indicadorId)).toEqual([2])
    expect(r.emprestimos).toHaveLength(0)
    const permitidos = new Set(r.vendas.map((v) => v.clienteId))
    expect(r.clientes.every((c) => permitidos.has(c.id))).toBe(true)
    expect(r.indicadores.map((i) => i.id)).toEqual([2])
    expect(r.bens.every((b) => b.custo === 0)).toBe(true)
  })

  it('indicador não recebe repasse de outro indicador', () => {
    const r = aplicarEscopo(d, { perfil: 'INDICADOR', indicadorId: 2 })
    expect(r.repasses).toHaveLength(0)
    expect(aplicarEscopo(d, { perfil: 'INDICADOR', indicadorId: 1 }).repasses).toHaveLength(1)
  })

  it('nada do seed original é alterado ao filtrar', () => {
    aplicarEscopo(d, { perfil: 'VENDEDOR', usuarioId: 2 })
    expect(d.bens.some((b) => b.custo > 0)).toBe(true)
  })
})
