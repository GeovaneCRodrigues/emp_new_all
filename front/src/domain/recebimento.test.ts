import { describe, expect, it } from 'vitest'
import { calcularRecebimento, calcularRecebimentoJuros, descreverEfeitos, ErroRecebimento, referencia, type ParcelaAberta } from './recebimento'

// Mesmos cenários de back/tests/recebimento-calculo.test.ts: a tela e a demonstração têm de prever o que o servidor vai fazer.
const HOJE = '2026-10-08'
const p = (numero: number, valor: number, vencimento: string, extra: Partial<ParcelaAberta> = {}): ParcelaAberta => ({ id: numero, numero, vencimento, vencimentoOriginal: null, valor, desconto: 0, pago: 0, quitadaEm: null, ...extra })
const pedido = (extra: object) => ({ numero: 1, valor: 100, data: HOJE, hoje: HOJE, ...extra })
const erro = (f: () => unknown) => { try { f() } catch (e) { return e as ErroRecebimento } return null }

describe('pagamento parcial', () => {
  // parcela de 800 vencida em 01/09, cliente paga 100 em 08/10 e escolhe "+7 dias"
  const base = [p(1, 800, '2026-09-01'), p(2, 800, '2026-10-01')]
  it('a parcela fica com 700, vence 15/10 e guarda o vencimento antigo', () => {
    const r = calcularRecebimento(base, pedido({ resto: 'FICA', novoVenc: '2026-10-15' }))
    expect(r.itens[0]).toMatchObject({ numero: 1, valorPago: 100, faltaDepois: 700 })
    expect(r.itens[0].depois).toMatchObject({ vencimento: '2026-10-15', vencimentoOriginal: '2026-09-01', quitadaEm: null })
    expect(r.efeitos).toEqual([{ tipo: 'FICA', numero: 1, resta: 700, vencimento: '2026-10-15' }])
  })
  it('sem data escolhida, o restante vai para +7 dias quando já venceu; mantém a data se não venceu', () => {
    expect(calcularRecebimento(base, pedido({ resto: 'FICA' })).itens[0].depois.vencimento).toBe('2026-10-15')
    expect(calcularRecebimento([p(1, 800, '2026-10-20')], pedido({ resto: 'FICA' })).itens[0].depois).toMatchObject({ vencimento: '2026-10-20', vencimentoOriginal: null })
  })
  it('o vencimento original não é sobrescrito numa segunda remarcação', () => {
    const r = calcularRecebimento([p(1, 800, '2026-10-15', { vencimentoOriginal: '2026-09-01', pago: 100 })], pedido({ valor: 50, resto: 'FICA', novoVenc: '2026-10-22' }))
    expect(r.itens[0].depois).toMatchObject({ vencimento: '2026-10-22', vencimentoOriginal: '2026-09-01' })
    expect(r.itens[0].faltaDepois).toBe(650)
  })
  it('"dar desconto" quita a parcela e registra o desconto', () => {
    const r = calcularRecebimento(base, pedido({ resto: 'DESCONTO' }))
    expect(r.itens[0].depois).toMatchObject({ desconto: 700, quitadaEm: HOJE })
    expect(r.efeitos).toEqual([{ tipo: 'DESCONTO', numero: 1, valor: 700 }])
  })
  it('sem dizer o que fazer com o resto: recusa; nova data fora do intervalo: recusa', () => {
    expect(erro(() => calcularRecebimento(base, pedido({})))?.codigo).toBe('RESTO_OBRIGATORIO')
    for (const novoVenc of ['2026-10-07', '2027-10-09', 'amanhã']) expect(erro(() => calcularRecebimento(base, pedido({ resto: 'FICA', novoVenc })))?.codigo).toBe('VENCIMENTO_INVALIDO')
  })
})

describe('pagou o valor certo e pagou a mais', () => {
  it('quita a parcela, contando o que já tinha sido pago e o desconto de antes', () => {
    expect(calcularRecebimento([p(1, 300, '2026-10-05')], pedido({ valor: 300 })).efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }])
    expect(calcularRecebimento([p(1, 800, '2026-10-05', { pago: 100 })], pedido({ valor: 700 })).efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }])
    expect(calcularRecebimento([p(1, 800, '2026-10-05', { desconto: 50 })], pedido({ valor: 750 })).efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }])
  })
  const base = [p(1, 300, '2026-10-05'), p(2, 300, '2026-11-05'), p(3, 300, '2026-12-05')] // cliente paga 750
  it('quita a atual e a próxima, e abate 150 da seguinte', () => {
    const r = calcularRecebimento(base, pedido({ valor: 750 }))
    expect(r.efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }, { tipo: 'QUITA', numero: 2 }, { tipo: 'ABATE', numero: 3, valor: 150 }])
    expect(r.itens.map((i) => [i.numero, i.valorPago, i.faltaDepois])).toEqual([[1, 300, 0], [2, 300, 0], [3, 150, 150]])
  })
  it('começa pela parcela escolhida e pula as que já estão pagas', () => {
    const r = calcularRecebimento([p(1, 300, '2026-10-05', { pago: 300 }), p(2, 300, '2026-11-05'), p(3, 300, '2026-12-05')], pedido({ numero: 2, valor: 450 }))
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

describe('textos', () => {
  it('referencia: uma parcela ou várias', () => {
    expect(referencia([2], 12)).toBe('parcela 2/12')
    expect(referencia([4, 2, 3], 12)).toBe('parcelas 2 a 4 de 12')
  })
  it('descreve o efeito em português', () => {
    const fmt = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`
    const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
    expect(descreverEfeitos([{ tipo: 'QUITA', numero: 1 }, { tipo: 'QUITA', numero: 2 }, { tipo: 'ABATE', numero: 3, valor: 150 }], fmt, dmy)).toBe('Quita a 1ª, quita a 2ª, abate R$ 150,00 da 3ª')
    expect(descreverEfeitos([{ tipo: 'FICA', numero: 1, resta: 700, vencimento: '2026-10-15' }], fmt, dmy)).toBe('A 1ª fica com R$ 700,00, para 15/10')
  })
})

describe('empréstimo só juros: o excedente amortiza o capital (espelha o backend)', () => {
  const parc = (numero: number, valor: number, extra: Partial<ParcelaAberta> = {}): ParcelaAberta => ({ id: numero, numero, vencimento: `2026-0${numero + 5}-10`, vencimentoOriginal: null, valor, desconto: 0, pago: 0, quitadaEm: null, ...extra })
  const plano = () => [parc(1, 360), parc(2, 360), parc(3, 3360)]
  const pedido = (valor: number, extra: object = {}) => ({ numero: 1, valor, data: '2026-10-08', hoje: '2026-10-08', ...extra })
  const opc = { capitalAberto: 3000, taxa: 12 }

  it('pagou o juro certo: quita a parcela e não mexe em mais nada', () => {
    const r = calcularRecebimentoJuros(plano(), pedido(360), opc)
    expect(r.efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }])
    expect(r.ajustes).toEqual([])
  })
  it('exemplo do Geovane: 1.000 na 1ª → 360 de juro, 640 abatem o capital (2.360) e o juro seguinte é 283,20', () => {
    const r = calcularRecebimentoJuros(plano(), pedido(1000), opc)
    expect(r.amortizacao).toBe(640)
    expect(r.capitalRestante).toBe(2360)
    expect(r.efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }, { tipo: 'AMORTIZA', valor: 640, capitalRestante: 2360 }])
    expect(r.ajustes.map((a) => [a.numero, a.depois.valor])).toEqual([[2, 283.2], [3, 2643.2]])
    expect(r.ajustes[0].antes.valor).toBe(360)
  })
  it('juro + todo o capital (3.360) quita o empréstimo: parcelas seguintes zeradas e quitadas', () => {
    const r = calcularRecebimentoJuros(plano(), pedido(3360), opc)
    expect(r.capitalRestante).toBe(0)
    expect(r.ajustes.map((a) => [a.numero, a.depois.valor, a.depois.quitadaEm])).toEqual([[2, 0, '2026-10-08'], [3, 0, '2026-10-08']])
  })
  it('passar de juro + capital, ou sobrar na última parcela, é recusado', () => {
    expect(() => calcularRecebimentoJuros(plano(), pedido(3360.01), opc)).toThrowError(/faltam 3360,00/)
    const ps = [parc(1, 360, { quitadaEm: '2026-09-01', pago: 360 }), parc(2, 360, { quitadaEm: '2026-09-02', pago: 360 }), parc(3, 3360)]
    expect(() => calcularRecebimentoJuros(ps, pedido(4000, { numero: 3 }), opc)).toThrowError(/passa do que falta/)
  })
  it('pagou menos que o juro: o resto fica devendo e não amortiza', () => {
    const r = calcularRecebimentoJuros(plano(), pedido(100, { resto: 'FICA', novoVenc: '2026-10-20' }), opc)
    expect(r.efeitos).toEqual([{ tipo: 'FICA', numero: 1, resta: 260, vencimento: '2026-10-20' }])
    expect(r.ajustes).toEqual([])
  })
  it('usa o capital que sobrou depois de amortizações anteriores', () => {
    const ps = [parc(1, 360, { pago: 360, quitadaEm: '2026-09-01' }), parc(2, 283.2), parc(3, 2643.2)]
    const r = calcularRecebimentoJuros(ps, pedido(1283.2, { numero: 2 }), { capitalAberto: 2360, taxa: 12 })
    expect(r.capitalRestante).toBe(1360)
    expect(r.ajustes.map((a) => [a.numero, a.depois.valor])).toEqual([[3, 1523.2]])
  })
  it('a prévia em português fala da amortização', () => {
    const r = calcularRecebimentoJuros(plano(), pedido(1000), opc)
    expect(descreverEfeitos(r.efeitos, (v) => `R$ ${v}`, (d) => d)).toBe('Quita a 1ª, abate R$ 640 do capital (sobram R$ 2360)')
  })
})
