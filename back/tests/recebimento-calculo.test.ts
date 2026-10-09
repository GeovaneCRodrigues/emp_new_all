import { describe, expect, it } from 'vitest'
import { calcularRecebimentoJuros, calcularRecebimento, ErroRecebimento, referencia, type ParcelaAberta } from '../src/modules/recebimentos/services/calculo.js'

const HOJE = '2026-10-08'
const p = (numero: number, valor: number, vencimento: string, extra: Partial<ParcelaAberta> = {}): ParcelaAberta => ({ id: numero, numero, vencimento, vencimentoOriginal: null, valor, desconto: 0, pago: 0, quitadaEm: null, ...extra })
const pedido = (extra: object) => ({ numero: 1, valor: 100, data: HOJE, hoje: HOJE, ...extra })
const erro = (f: () => unknown) => { try { f() } catch (e) { return e as ErroRecebimento } return null }

describe('pagamento parcial', () => {
  // parcela de 800 vencida em 01/09, cliente paga 100 em 08/10 e escolhe "+7 dias"
  const base = [p(1, 800, '2026-09-01'), p(2, 800, '2026-10-01')]

  it('a parcela fica com 700, vence 15/10 e guarda o vencimento antigo', () => {
    const r = calcularRecebimento(base, pedido({ resto: 'FICA', novoVenc: '2026-10-15' }))
    expect(r.itens).toHaveLength(1)
    expect(r.itens[0]).toMatchObject({ numero: 1, valorPago: 100, faltaDepois: 700 })
    expect(r.itens[0].depois).toMatchObject({ vencimento: '2026-10-15', vencimentoOriginal: '2026-09-01', quitadaEm: null })
    expect(r.efeitos).toEqual([{ tipo: 'FICA', numero: 1, resta: 700, vencimento: '2026-10-15' }])
  })
  it('sem data escolhida, o restante vai para +7 dias quando já venceu', () => {
    expect(calcularRecebimento(base, pedido({ resto: 'FICA' })).itens[0].depois.vencimento).toBe('2026-10-15')
  })
  it('mantém a data se a parcela ainda não venceu', () => {
    const r = calcularRecebimento([p(1, 800, '2026-10-20')], pedido({ resto: 'FICA' }))
    expect(r.itens[0].depois).toMatchObject({ vencimento: '2026-10-20', vencimentoOriginal: null })
  })
  it('o vencimento original não é sobrescrito numa segunda remarcação', () => {
    const r = calcularRecebimento([p(1, 800, '2026-10-15', { vencimentoOriginal: '2026-09-01', pago: 100 })], pedido({ valor: 50, resto: 'FICA', novoVenc: '2026-10-22' }))
    expect(r.itens[0].depois).toMatchObject({ vencimento: '2026-10-22', vencimentoOriginal: '2026-09-01' })
    expect(r.itens[0].faltaDepois).toBe(650)
  })
  it('as próximas parcelas não mudam', () => expect(calcularRecebimento(base, pedido({ resto: 'FICA' })).itens.map((i) => i.numero)).toEqual([1]))
  it('"dar desconto" quita a parcela e registra o desconto', () => {
    const r = calcularRecebimento(base, pedido({ resto: 'DESCONTO' }))
    expect(r.itens[0].depois).toMatchObject({ desconto: 700, quitadaEm: HOJE })
    expect(r.itens[0].faltaDepois).toBe(0)
    expect(r.efeitos).toEqual([{ tipo: 'DESCONTO', numero: 1, valor: 700 }])
  })
  it('pagou menos sem dizer o que fazer com o resto: recusa', () => expect(erro(() => calcularRecebimento(base, pedido({})))?.codigo).toBe('RESTO_OBRIGATORIO'))
  it.each([['antes de hoje', '2026-10-07'], ['mais de um ano', '2027-10-09'], ['texto', 'amanhã']])('recusa nova data %s', (_n, novoVenc) =>
    expect(erro(() => calcularRecebimento(base, pedido({ resto: 'FICA', novoVenc })))?.codigo).toBe('VENCIMENTO_INVALIDO'))
})

describe('pagou o valor certo', () => {
  it('quita a parcela', () => {
    const r = calcularRecebimento([p(1, 300, '2026-10-05')], pedido({ valor: 300 }))
    expect(r.efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }])
    expect(r.itens[0].depois.quitadaEm).toBe(HOJE)
  })
  it('conta o que já tinha sido pago antes', () => {
    const r = calcularRecebimento([p(1, 800, '2026-10-05', { pago: 100 })], pedido({ valor: 700 }))
    expect(r.efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }])
  })
  it('conta o desconto de antes', () => {
    expect(calcularRecebimento([p(1, 800, '2026-10-05', { desconto: 50 })], pedido({ valor: 750 })).efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }])
  })
})

describe('pagou a mais', () => {
  // parcelas de 300 e cliente paga 750
  const base = [p(1, 300, '2026-10-05'), p(2, 300, '2026-11-05'), p(3, 300, '2026-12-05')]
  it('quita a atual e a próxima, e abate 150 da seguinte', () => {
    const r = calcularRecebimento(base, pedido({ valor: 750 }))
    expect(r.itens.map((i) => [i.numero, i.valorPago, i.faltaDepois])).toEqual([[1, 300, 0], [2, 300, 0], [3, 150, 150]])
    expect(r.efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }, { tipo: 'QUITA', numero: 2 }, { tipo: 'ABATE', numero: 3, valor: 150 }])
    expect(r.valorTotal).toBe(750)
  })
  it('começa pela parcela escolhida e pula as que já estão pagas', () => {
    const r = calcularRecebimento([p(1, 300, '2026-10-05', { pago: 300, quitadaEm: '2026-10-01' }), p(2, 300, '2026-11-05'), p(3, 300, '2026-12-05')], pedido({ numero: 2, valor: 450 }))
    expect(r.itens.map((i) => i.numero)).toEqual([2, 3])
  })
  it('valor acima do que falta é recusado (não vira crédito)', () => {
    expect(erro(() => calcularRecebimento(base, pedido({ valor: 900.01 })))?.codigo).toBe('EXCEDE_DIVIDA')
    expect(calcularRecebimento(base, pedido({ valor: 900 })).itens).toHaveLength(3)
  })
})

describe('entradas inválidas', () => {
  const base = [p(1, 300, '2026-10-05'), p(2, 300, '2026-11-05', { pago: 300, quitadaEm: '2026-10-01' })]
  it.each([0, -5, NaN, Infinity])('valor %s é recusado', (valor) => expect(erro(() => calcularRecebimento(base, pedido({ valor })))?.codigo).toBe('VALOR_INVALIDO'))
  it('parcela inexistente e parcela já paga', () => {
    expect(erro(() => calcularRecebimento(base, pedido({ numero: 9 })))?.codigo).toBe('PARCELA_INEXISTENTE')
    expect(erro(() => calcularRecebimento(base, pedido({ numero: 2, valor: 10 })))?.codigo).toBe('PARCELA_PAGA')
  })
  it('não mexe nas parcelas que recebeu', () => {
    const copia = JSON.stringify(base)
    calcularRecebimento(base, pedido({ valor: 100, resto: 'FICA' }))
    expect(JSON.stringify(base)).toBe(copia)
  })
})

describe('referencia', () => {
  it('uma parcela ou várias', () => {
    expect(referencia([2], 12)).toBe('parcela 2/12')
    expect(referencia([4, 2, 3], 12)).toBe('parcelas 2 a 4 de 12')
  })
})

describe('empréstimo só juros: o excedente amortiza o capital', () => {
  // 3.000 a 12% em 3x: 360, 360 e 3.360 (capital na última)
  const parc = (numero: number, valor: number, extra: Partial<ParcelaAberta> = {}): ParcelaAberta => ({ id: numero, numero, vencimento: `2026-0${numero + 5}-10`, vencimentoOriginal: null, valor, desconto: 0, pago: 0, quitadaEm: null, ...extra })
  const plano = () => [parc(1, 360), parc(2, 360), parc(3, 3360)]
  const pedido = (valor: number, extra: object = {}) => ({ numero: 1, valor, data: '2026-10-08', hoje: '2026-10-08', ...extra })
  const opc = { capitalAberto: 3000, taxa: 12 }

  it('pagou o juro certo: quita a parcela e não mexe em mais nada', () => {
    const r = calcularRecebimentoJuros(plano(), pedido(360), opc)
    expect(r.efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }])
    expect(r.amortizacao).toBe(0)
    expect(r.ajustes).toEqual([])
    expect(r.capitalRestante).toBe(3000)
  })
  it('exemplo do Geovane: 1.000 na 1ª → 360 de juro, 640 abatem o capital (2.360) e o juro seguinte é 283,20', () => {
    const r = calcularRecebimentoJuros(plano(), pedido(1000), opc)
    expect(r.itens).toHaveLength(1)
    expect(r.itens[0]).toMatchObject({ numero: 1, valorPago: 360, faltaDepois: 0 })
    expect(r.amortizacao).toBe(640)
    expect(r.capitalRestante).toBe(2360)
    expect(r.efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }, { tipo: 'AMORTIZA', valor: 640, capitalRestante: 2360 }])
    expect(r.ajustes.map((a) => [a.numero, a.depois.valor])).toEqual([[2, 283.2], [3, 2643.2]])
    expect(r.ajustes[0].antes.valor).toBe(360) // guarda o valor antigo para o "desfazer"
    expect(r.valorTotal).toBe(1000)
  })
  it('juro + todo o capital (3.360) quita o empréstimo: as parcelas seguintes ficam zeradas e quitadas', () => {
    const r = calcularRecebimentoJuros(plano(), pedido(3360), opc)
    expect(r.capitalRestante).toBe(0)
    expect(r.ajustes.map((a) => [a.numero, a.depois.valor, a.depois.quitadaEm])).toEqual([[2, 0, '2026-10-08'], [3, 0, '2026-10-08']])
  })
  it('passar de juro + capital é recusado', () => {
    expect(() => calcularRecebimentoJuros(plano(), pedido(3360.01), opc)).toThrowError(/faltam 3360,00/)
  })
  it('excedente na última parcela é recusado (não há o que amortizar depois dela)', () => {
    const ps = [parc(1, 360, { quitadaEm: '2026-09-01', pago: 360 }), parc(2, 360, { quitadaEm: '2026-09-02', pago: 360 }), parc(3, 3360)]
    expect(() => calcularRecebimentoJuros(ps, pedido(4000, { numero: 3 }), opc)).toThrowError(/passa do que falta/)
  })
  it('pagou menos que o juro: vale a regra de sempre (o resto fica devendo) e não amortiza', () => {
    const r = calcularRecebimentoJuros(plano(), pedido(100, { resto: 'FICA', novoVenc: '2026-10-20' }), opc)
    expect(r.efeitos).toEqual([{ tipo: 'FICA', numero: 1, resta: 260, vencimento: '2026-10-20' }])
    expect(r.amortizacao).toBe(0)
    expect(r.ajustes).toEqual([])
  })
  it('já houve amortização antes: usa o capital que sobrou, não o original', () => {
    const ps = [parc(1, 360, { pago: 360, quitadaEm: '2026-09-01' }), parc(2, 283.2), parc(3, 2643.2)]
    const r = calcularRecebimentoJuros(ps, pedido(1283.2, { numero: 2 }), { capitalAberto: 2360, taxa: 12 })
    expect(r.amortizacao).toBe(1000)
    expect(r.capitalRestante).toBe(1360)
    expect(r.ajustes.map((a) => [a.numero, a.depois.valor])).toEqual([[3, 1523.2]]) // 1.360 + 12% de 1.360 (163,20)
  })
  it('não recalcula parcela que já recebeu pagamento parcial', () => {
    const ps = [parc(1, 360), parc(2, 360, { pago: 100 }), parc(3, 3360)]
    const r = calcularRecebimentoJuros(ps, pedido(1000), opc)
    expect(r.ajustes.map((a) => a.numero)).toEqual([3])
  })
  it('valor inválido, parcela inexistente e parcela já paga seguem dando erro', () => {
    expect(() => calcularRecebimentoJuros(plano(), pedido(0), opc)).toThrow()
    expect(() => calcularRecebimentoJuros(plano(), pedido(100, { numero: 9 }), opc)).toThrow(/não encontrada/)
    expect(() => calcularRecebimentoJuros([parc(1, 360, { pago: 360, quitadaEm: '2026-09-01' }), parc(2, 360)], pedido(100), opc)).toThrow(/já está paga/)
  })
})
