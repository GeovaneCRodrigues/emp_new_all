import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { janela, lucroPorMesTodos, lucroRealizadoAte, montarRelatorios, somaMes, type OpRelatorio } from './relatorios'

const op = (o: Partial<OpRelatorio> = {}): OpRelatorio => ({
  tipo: 'EMPRESTIMO', id: 1, data: '2026-09-01', status: 'ATIVA', indicadorId: null, pct: 0, investido: 1000, total: 1500, recebido: 0, falta: 1500, lucroTotal: 500, capitalDeVolta: 0,
  jurosRecebidos: null, modelo: null, diasParado: null, parcelas: [], entradas: [], ...o,
})

describe('relatórios (cópia do cálculo do backend)', () => {
  it('dá o mesmo resultado que o backend no cenário combinado (arquivo gerado pelo backend)', () => {
    const f = JSON.parse(readFileSync(new URL('../../../back/tests/fixtures/relatorios/paridade.json', import.meta.url), 'utf8'))
    expect(montarRelatorios(f.ops, f.extras)).toEqual(f.esperado)
  })
  it('o capital volta primeiro; o resto é lucro, sem a parte do indicador', () => {
    expect(lucroRealizadoAte(op(), 1000)).toBe(0); expect(lucroRealizadoAte(op(), 1200)).toBe(200); expect(lucroRealizadoAte(op({ pct: 0.5 }), 1200)).toBe(100)
  })
  it('lucro por mês na ordem do dinheiro que entrou', () => {
    const o = op({ recebido: 1600, entradas: [{ data: '2026-10-05', valor: 400 }, { data: '2026-08-10', valor: 600 }, { data: '2026-09-10', valor: 600 }] })
    expect([...lucroPorMesTodos([o])]).toEqual([['2026-09', 200], ['2026-10', 400]])
  })
  it('meses atravessam o ano', () => {
    expect(somaMes('2026-11', 3)).toBe('2027-02'); expect(janela('2026-10-10', -3, 3)).toHaveLength(7)
  })
})
