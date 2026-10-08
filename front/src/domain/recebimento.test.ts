import { describe, expect, it } from 'vitest'
import { faltaP } from './calc'
import { aplicarRecebimento, desfazerTransacao, planoRecebimento } from './recebimento'
import type { Parcela } from './types'

const HOJE = '2026-10-08'
const p = (n: number, valor: number, venc: string): Parcela => ({ n, venc, valor, pago: null, pagos: [], desconto: 0 })

describe('pagamento parcial', () => {
  // parcela de 800 vencida em 01/09, cliente paga 100 em 08/10 e escolhe "+7 dias"
  const base = [p(1, 800, '2026-09-01'), p(2, 800, '2026-10-01')]
  const rec = { n: 1, data: HOJE, valor: 100, forma: 'Pix' as const, resto: 'FICA' as const, novoVenc: '2026-10-15', tx: 1 }

  it('a parcela fica com 700, vence 15/10 e guarda o vencimento antigo', () => {
    const [a] = aplicarRecebimento(base, rec, HOJE)
    expect(faltaP(a)).toBe(700)
    expect(a.venc).toBe('2026-10-15')
    expect(a.vencOriginal).toBe('2026-09-01')
    expect(a.pago).toBeNull()
  })

  it('sai dos atrasados e as próximas parcelas mantêm as datas', () => {
    const novas = aplicarRecebimento(base, rec, HOJE)
    expect(novas[0].venc >= HOJE).toBe(true)
    expect(novas[1].venc).toBe('2026-10-01')
  })

  it('não altera o array original', () => {
    aplicarRecebimento(base, rec, HOJE)
    expect(base[0].pagos).toHaveLength(0)
    expect(base[0].venc).toBe('2026-09-01')
  })

  it('o vencimento original não é sobrescrito numa segunda remarcação', () => {
    const um = aplicarRecebimento(base, rec, HOJE)
    const dois = aplicarRecebimento(um, { ...rec, valor: 50, novoVenc: '2026-10-22', tx: 2 }, HOJE)
    expect(dois[0].vencOriginal).toBe('2026-09-01')
    expect(dois[0].venc).toBe('2026-10-22')
  })

  it('sem data escolhida, o restante vai para +7 dias quando já venceu', () => {
    const [a] = aplicarRecebimento(base, { ...rec, novoVenc: undefined }, HOJE)
    expect(a.venc).toBe('2026-10-15')
  })

  it('"Dar desconto" quita a parcela e registra o desconto', () => {
    const [a] = aplicarRecebimento(base, { ...rec, resto: 'DESCONTO', novoVenc: undefined }, HOJE)
    expect(a.pago).toBe(HOJE)
    expect(a.desconto).toBe(700)
    expect(faltaP(a)).toBe(0)
  })

  it('a prévia descreve o efeito', () => {
    expect(planoRecebimento(base, rec, HOJE)).toEqual([{ tipo: 'FICA', n: 1, resta: 700, venc: '2026-10-15' }])
  })
})

describe('pagamento a mais', () => {
  // parcelas de 300 e cliente paga 750
  const base = [p(1, 300, '2026-10-05'), p(2, 300, '2026-11-05'), p(3, 300, '2026-12-05')]
  const rec = { n: 1, data: HOJE, valor: 750, forma: 'Dinheiro' as const, tx: 7 }

  it('quita a atual e a próxima, e abate 150 da seguinte', () => {
    const [a, b, c] = aplicarRecebimento(base, rec, HOJE)
    expect(a.pago).toBe(HOJE)
    expect(b.pago).toBe(HOJE)
    expect(c.pago).toBeNull()
    expect(faltaP(c)).toBe(150)
  })

  it('é uma transação só', () => {
    const txs = new Set(aplicarRecebimento(base, rec, HOJE).flatMap((x) => x.pagos.map((g) => g.tx)))
    expect([...txs]).toEqual([7])
  })

  it('a prévia lista quita, quita e abate', () => {
    expect(planoRecebimento(base, rec, HOJE)).toEqual([
      { tipo: 'QUITA', n: 1 }, { tipo: 'QUITA', n: 2 }, { tipo: 'ABATE', n: 3, valor: 150 },
    ])
  })

  it('o que sobra sem parcela para abater vira crédito', () => {
    expect(planoRecebimento([p(1, 300, '2026-10-05')], { n: 1, valor: 400 }, HOJE).at(-1)).toEqual({ tipo: 'CREDITO', valor: 100 })
  })
})

describe('desfazer', () => {
  it('volta tudo como estava, inclusive vencimento e desconto', () => {
    const base = [p(1, 800, '2026-09-01'), p(2, 800, '2026-10-01')]
    const feito = aplicarRecebimento(base, { n: 1, data: HOJE, valor: 100, forma: 'Pix', resto: 'FICA', novoVenc: '2026-10-15', tx: 1 }, HOJE)
    expect(desfazerTransacao(feito, 1)).toEqual(base)
  })

  it('desfaz desconto e pagamento a mais de uma vez só', () => {
    const base = [p(1, 300, '2026-10-05'), p(2, 300, '2026-11-05')]
    const feito = aplicarRecebimento(base, { n: 1, data: HOJE, valor: 400, forma: 'Pix', tx: 3 }, HOJE)
    expect(desfazerTransacao(feito, 3)).toEqual(base)
    const comDesc = aplicarRecebimento(base, { n: 1, data: HOJE, valor: 100, forma: 'Pix', resto: 'DESCONTO', tx: 4 }, HOJE)
    expect(desfazerTransacao(comDesc, 4)).toEqual(base)
  })

  it('só desfaz a transação pedida', () => {
    const base = [p(1, 300, '2026-10-05')]
    const a = aplicarRecebimento(base, { n: 1, data: HOJE, valor: 100, forma: 'Pix', resto: 'FICA', novoVenc: '2026-10-05', tx: 1 }, HOJE)
    const b = aplicarRecebimento(a, { n: 1, data: HOJE, valor: 50, forma: 'Pix', resto: 'FICA', novoVenc: '2026-10-05', tx: 2 }, HOJE)
    expect(faltaP(desfazerTransacao(b, 2)[0])).toBe(200)
  })
})
