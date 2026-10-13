import { describe, expect, it } from 'vitest'
import { diasDeAtraso, estadoParcela, proximaParcela, resumoAndamento } from './andamento'

const HOJE = '2026-10-15'
const p = (numero: number, vencimento: string, valor: number, pago = 0, o: Partial<{ desconto: number; acordo: 'NOVA' | 'ENCERRADA' | null; quitadaEm: string | null }> = {}) => ({
  numero, vencimento, valor, desconto: 0, pago, falta: Math.max(0, Math.round((valor - pago - (o.desconto ?? 0)) * 100) / 100), quitadaEm: null, acordo: null, ...o,
})

describe('estado de cada parcela', () => {
  it('paga, parcial, atrasada, vence hoje e a vencer', () => {
    expect(estadoParcela(p(1, '2026-10-01', 100, 100), HOJE)).toBe('paga')
    expect(estadoParcela(p(1, '2026-10-30', 100, 40), HOJE)).toBe('parcial')
    expect(estadoParcela(p(1, '2026-10-10', 100, 40), HOJE)).toBe('atrasada') // pagou em parte mas venceu: atrasada
    expect(estadoParcela(p(1, '2026-10-10', 100), HOJE)).toBe('atrasada')
    expect(estadoParcela(p(1, HOJE, 100), HOJE)).toBe('hoje')
    expect(estadoParcela(p(1, '2026-11-01', 100), HOJE)).toBe('aberta')
  })
  it('desconto que zera a falta conta como paga; parcela encerrada por acordo é só "encerrada"', () => {
    expect(estadoParcela(p(1, '2026-10-01', 100, 60, { desconto: 40 }), HOJE)).toBe('paga')
    expect(estadoParcela(p(1, '2026-10-01', 100, 30, { acordo: 'ENCERRADA' }), HOJE)).toBe('encerrada')
    expect(estadoParcela(p(1, '2026-09-01', 100, 0, { acordo: 'ENCERRADA' }), HOJE)).toBe('encerrada')
  })
  it('centavos de arredondamento não deixam a parcela em aberto', () => {
    expect(estadoParcela({ falta: 0.004, pago: 99.996, vencimento: '2026-10-01', acordo: null }, HOJE)).toBe('paga')
  })
})

describe('próxima parcela e resumo', () => {
  const ps = [p(1, '2026-09-15', 100, 100), p(2, '2026-10-10', 100), p(3, '2026-10-20', 100), p(4, '2026-11-20', 100)]
  it('é a de vencimento mais antigo entre as que faltam (a atrasada vem primeiro)', () => {
    expect(proximaParcela(ps)?.numero).toBe(2)
    expect(proximaParcela(ps.slice(2))?.numero).toBe(3)
  })
  it('tudo pago ou sem parcela: não há próxima', () => {
    expect(proximaParcela([p(1, '2026-09-15', 100, 100)])).toBeNull(); expect(proximaParcela([])).toBeNull()
  })
  it('parcela encerrada por acordo não é próxima nem entra na contagem', () => {
    const com = [p(1, '2026-09-15', 100, 30, { acordo: 'ENCERRADA' }), p(2, '2026-12-01', 200, 0, { acordo: 'NOVA' })]
    expect(proximaParcela(com)?.numero).toBe(2)
    expect(resumoAndamento(com, HOJE)).toMatchObject({ pagas: 0, total: 1, atrasadas: 0 })
  })
  it('conta pagas, atrasadas e o valor atrasado', () => {
    const r = resumoAndamento([...ps, p(5, '2026-10-12', 50, 20)], HOJE)
    expect(r).toMatchObject({ pagas: 1, total: 5, atrasadas: 2, valorAtrasado: 100 + 30 })
    expect(r.proxima?.numero).toBe(2)
  })
  it('dias de atraso nunca negativo', () => {
    expect(diasDeAtraso('2026-10-10', HOJE)).toBe(5); expect(diasDeAtraso(HOJE, HOJE)).toBe(0); expect(diasDeAtraso('2026-11-01', HOJE)).toBe(0)
  })
})
