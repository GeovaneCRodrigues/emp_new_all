import { describe, expect, it } from 'vitest'
import { contasVenda } from './calc'
import { nivelDe, previsaoRepasse, repassesDoIndicador, type OpComContas } from './repasse'
import type { Bem, Parcela, Venda } from './types'

const HOJE = '2026-10-08'
const bem: Bem = { id: 1, modelo: 'iPhone', gb: 128, cor: 'Preto', bateria: 90, cond: 'Seminovo', imei: '', custo: 1000, extras: 0, preco: 2000, estado: 'VENDIDO', desde: '2026-01-01', origem: 'COMPRA' }
const parc = (n: number, valor: number, pago: boolean, venc = '2026-11-01'): Parcela => ({
  n, venc, valor, pago: pago ? '2026-09-01' : null, desconto: 0,
  pagos: pago ? [{ data: '2026-09-01', valor, forma: 'Pix', tx: n }] : [],
})
// entrada 1.500 + parcelas já pagas somando o necessário
const op = (id: number, data: string, pagas: number): OpComContas => {
  const v: Venda = {
    tipo: 'VENDA', id, bemId: 1, clienteId: 1, data, entrada: 1000, troca: 0, indicadorId: 1, pct: 0.5, contrato: 'ASSINADO', status: 'ATIVA',
    parcelas: [parc(1, 500, pagas >= 1), parc(2, 500, pagas >= 2)],
  }
  return { o: v, k: contasVenda(v, bem, HOJE) }
}

describe('repasse por indicador', () => {
  it('o indicador só ganha depois que o capital voltou', () => {
    const r = repassesDoIndicador([op(1, '2026-01-01', 0)], [])
    // recebido 1.000 = capital 1.000 → nada liberado
    expect(r.liberado).toBe(0)
  })

  it('50% do que passou do capital', () => {
    const r = repassesDoIndicador([op(1, '2026-01-01', 2)], [])
    // recebido 2.000, capital 1.000 → lucro 1.000 → 500
    expect(r.liberado).toBe(500)
    expect(r.aPagar).toBe(500)
  })

  it('pagamento do indicador abate da operação mais antiga para a mais nova', () => {
    const velha = op(1, '2026-01-01', 2)
    const nova = op(2, '2026-06-01', 2)
    const r = repassesDoIndicador([nova, velha], [{ indicadorId: 1, data: '2026-07-10', valor: 600, forma: 'Pix' }])
    expect(r.linhas.map((l) => l.o.id)).toEqual([1, 2])
    expect(r.linhas[0].pago).toBe(500)
    expect(r.linhas[0].aPagar).toBe(0)
    expect(r.linhas[1].pago).toBe(100)
    expect(r.linhas[1].aPagar).toBe(400)
    expect(r.aPagar).toBe(400)
    expect(r.jaPago).toBe(600)
  })

  it('pagamento acima do liberado vira sobra', () => {
    const r = repassesDoIndicador([op(1, '2026-01-01', 2)], [{ indicadorId: 1, data: '2026-07-10', valor: 700, forma: 'Pix' }])
    expect(r.sobra).toBe(200)
    expect(r.aPagar).toBe(0)
  })

  it('prevê quanto libera por mês nas parcelas abertas', () => {
    const o = op(1, '2026-01-01', 0) // recebido 1.000 (entrada) = capital; faltam 2 × 500
    const prev = previsaoRepasse([o], ['2026-10', '2026-11'], HOJE)
    expect(prev['2026-11']).toBe(500) // 1.000 de lucro × 50%
  })
})

describe('níveis', () => {
  it.each([
    [0, 'Bronze', 0.3], [2, 'Bronze', 0.3], [3, 'Prata', 0.4], [5, 'Ouro', 0.5], [10, 'Diamante', 0.55], [30, 'Diamante', 0.55],
  ])('%i operações → %s (%d)', (n, nome, pct) => {
    const r = nivelDe(n)
    expect(r.nivel.nome).toBe(nome)
    expect(r.nivel.pct).toBe(pct)
  })
  it('sabe qual é o próximo nível', () => {
    expect(nivelDe(4).prox?.nome).toBe('Ouro')
    expect(nivelDe(12).prox).toBeNull()
  })
})
