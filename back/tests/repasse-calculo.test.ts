import { describe, expect, it } from 'vitest'
import { calcularRepasse, type OperacaoRepasse } from '../src/modules/repasses/services/calculo.js'

const op = (o: Partial<OperacaoRepasse> = {}): OperacaoRepasse => ({
  tipo: 'VENDA', id: 1, data: '2026-09-01', clienteNome: 'Ana', descricao: 'iPhone', status: 'ATIVA',
  pct: 0.5, investido: 2500, total: 4000, descontos: 0, recebido: 0, ...o,
})

describe('repasse do indicador (exemplo do plano: custo 2.500, total 4.000, 50%)', () => {
  it('antes do capital voltar não libera nada, e o lucro previsto de 1.500 dá 750 ao indicador', () => {
    const r = calcularRepasse([op({ recebido: 2000 })], 0)
    expect(r.liberado).toBe(0)
    expect(r.operacoes[0].parte).toBe(750)
    expect(r.vaiLiberar).toBe(750)
    expect(r.operacoes[0].capitalVoltou).toBe(false)
  })
  it('capital voltou (2.500): ainda zero; cada real depois disso libera 50 centavos', () => {
    expect(calcularRepasse([op({ recebido: 2500 })], 0).liberado).toBe(0)
    const r = calcularRepasse([op({ recebido: 3000 })], 0)
    expect(r.liberado).toBe(250)
    expect(r.aPagar).toBe(250)
    expect(r.vaiLiberar).toBe(500)
    expect(r.operacoes[0].capitalVoltou).toBe(true)
  })
  it('quitada: libera os 750 inteiros e não sobra nada a liberar', () => {
    const r = calcularRepasse([op({ recebido: 4000, status: 'QUITADA' })], 0)
    expect(r.liberado).toBe(750)
    expect(r.vaiLiberar).toBe(0)
  })
  it('já pago abate: pagou 300 de 750, faltam 450', () => {
    const r = calcularRepasse([op({ recebido: 4000, status: 'QUITADA' })], 300)
    expect(r.pago).toBe(300)
    expect(r.aPagar).toBe(450)
    expect(r.operacoes[0].pagoNela).toBe(300)
  })
})

describe('várias operações do mesmo indicador', () => {
  const duas = [
    op({ id: 2, data: '2026-09-10', recebido: 4000, status: 'QUITADA' }), // 750 liberados, mais nova
    op({ id: 1, data: '2026-08-01', recebido: 4000, status: 'QUITADA' }), // 750 liberados, mais antiga
  ]
  it('o pagamento abate a mais antiga primeiro', () => {
    const r = calcularRepasse(duas, 900)
    expect(r.operacoes.map((o) => o.id)).toEqual([1, 2])
    expect(r.operacoes[0].pagoNela).toBe(750)
    expect(r.operacoes[1].pagoNela).toBe(150)
    expect(r.aPagar).toBe(600)
  })
  it('soma vendas e empréstimos (cada um com o seu % congelado)', () => {
    const r = calcularRepasse([
      op({ recebido: 4000, status: 'QUITADA' }), // 750
      op({ tipo: 'EMPRESTIMO', id: 9, descricao: 'Empréstimo', pct: 0.3, investido: 1000, total: 1300, recebido: 1300, status: 'QUITADA' }), // 300 × 30% = 90
    ], 0)
    expect(r.liberado).toBe(840)
  })
  it('empréstimo em andamento: capital 1.000, total 1.300, recebeu 1.150 → lucro de 150, indicador a 30% fica com 45', () => {
    const r = calcularRepasse([op({ tipo: 'EMPRESTIMO', pct: 0.3, investido: 1000, total: 1300, recebido: 1150 })], 0)
    expect(r.liberado).toBe(45)
    expect(r.vaiLiberar).toBe(45) // parte total 90 − 45
  })
})

describe('casos de borda', () => {
  it('cancelada não conta', () => {
    expect(calcularRepasse([op({ recebido: 4000, status: 'CANCELADA' })], 0).operacoes).toHaveLength(0)
  })
  it('retomada: libera só o que entrou além do capital e não promete mais nada', () => {
    const r = calcularRepasse([op({ recebido: 3000, status: 'RETOMADA' })], 0)
    expect(r.liberado).toBe(250)
    expect(r.vaiLiberar).toBe(0)
  })
  it('desconto diminui o lucro previsto', () => {
    const r = calcularRepasse([op({ recebido: 3500, descontos: 500 })], 0)
    expect(r.operacoes[0].parte).toBe(500) // (4000−500−2500)×50%
    expect(r.vaiLiberar).toBe(0) // já liberou (3500−2500)×50% = 500
  })
  it('prejuízo (total abaixo do capital) não gera parte negativa', () => {
    const r = calcularRepasse([op({ total: 2000, recebido: 2000, status: 'QUITADA' })], 0)
    expect(r.operacoes[0].parte).toBe(0)
    expect(r.liberado).toBe(0)
  })
  it('pagamento acima do liberado (recebimento desfeito depois) aparece como pago a mais e a pagar zero', () => {
    const r = calcularRepasse([op({ recebido: 3000 })], 400) // liberado 250
    expect(r.aPagar).toBe(0)
    expect(r.pagoAMais).toBe(150)
  })
  it('sem operações e sem pagamento: tudo zero', () => {
    expect(calcularRepasse([], 0)).toMatchObject({ liberado: 0, pago: 0, aPagar: 0, vaiLiberar: 0, pagoAMais: 0 })
  })
  it('centavos: nunca devolve -0 nem dízima', () => {
    const r = calcularRepasse([op({ pct: 0.3333, investido: 100, total: 133.33, recebido: 133.33, status: 'QUITADA' })], 0)
    expect(Number.isInteger(r.liberado * 100)).toBe(true)
    expect(Object.is(calcularRepasse([], 0).aPagar, -0)).toBe(false)
  })
})
