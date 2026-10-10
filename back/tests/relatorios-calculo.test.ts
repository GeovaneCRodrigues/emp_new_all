import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { janela, lucroPorMesTodos, lucroRealizado, lucroRealizadoAte, montarRelatorios, seuLucro, somaMes, type DadosExtras, type OpRelatorio } from '../src/modules/relatorios/services/calculo.js'

const HOJE = '2026-10-10'
const op = (o: Partial<OpRelatorio> = {}): OpRelatorio => ({
  tipo: 'EMPRESTIMO', id: 1, data: '2026-09-01', status: 'ATIVA', indicadorId: null, pct: 0, investido: 1000, total: 1500, recebido: 0, falta: 1500, lucroTotal: 500, capitalDeVolta: 0,
  jurosRecebidos: null, modelo: null, diasParado: null, parcelas: [], entradas: [], ...o,
})
const extras = (e: Partial<DadosExtras> = {}): DadosExtras => ({ hoje: HOJE, caixa: 0, estoque: 0, aportes: 0, repassesAPagar: 0, repassesFuturos: 0, indicadores: [], ...e })

describe('meses', () => {
  it('somaMes atravessa o ano nos dois sentidos', () => {
    expect(somaMes('2026-10', 3)).toBe('2027-01'); expect(somaMes('2026-02', -3)).toBe('2025-11'); expect(somaMes('2026-12', 1)).toBe('2027-01'); expect(somaMes('2026-01', -1)).toBe('2025-12')
  })
  it('janela inclui os extremos', () => {
    expect(janela(HOJE, -5, 0)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
    expect(janela(HOJE, -3, 3)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01'])
  })
})

describe('lucro realizado: o capital volta primeiro, o que passa é lucro', () => {
  it('antes de o capital voltar não há lucro', () => {
    expect(lucroRealizadoAte(op(), 0)).toBe(0); expect(lucroRealizadoAte(op(), 999.99)).toBe(0); expect(lucroRealizadoAte(op(), 1000)).toBe(0)
  })
  it('depois que o capital voltou, o resto é lucro (operação ainda em andamento)', () => {
    expect(lucroRealizadoAte(op(), 1200)).toBe(200)
    expect(lucroRealizado(op({ recebido: 1200 }))).toBe(200)
  })
  it('com indicador, a parte dele sai e o dono fica com o restante', () => {
    expect(lucroRealizadoAte(op({ pct: 0.5 }), 1200)).toBe(100)
    expect(lucroRealizadoAte(op({ pct: 0.3 }), 1500)).toBe(350)
  })
  it('quitada conta o lucro todo (já sem a parte do indicador)', () => {
    expect(lucroRealizado(op({ status: 'QUITADA', recebido: 1500, falta: 0, pct: 0.5 }))).toBe(250)
  })
  it('seuLucro: parte do dono se tudo for pago; prejuízo não é dividido com o indicador', () => {
    expect(seuLucro(op({ pct: 0.4 }))).toBe(300); expect(seuLucro(op({ lucroTotal: -200, pct: 0.5 }))).toBe(-200)
  })
  it('só juros dividido a cada pagamento: vale o juro recebido, proporcional ao que entrou', () => {
    const o = op({ jurosRecebidos: 200, recebido: 400, pct: 0.5 })
    expect(lucroRealizado(o)).toBe(100); expect(lucroRealizadoAte(o, 200)).toBe(50); expect(lucroRealizadoAte(o, 0)).toBe(0)
    expect(lucroRealizado(op({ jurosRecebidos: 0, recebido: 0 }))).toBe(0)
  })
})

describe('lucro por mês', () => {
  it('o mês em que o capital volta só leva o que passou dele', () => {
    const o = op({ recebido: 1600, entradas: [{ data: '2026-08-10', valor: 600 }, { data: '2026-09-10', valor: 600 }, { data: '2026-10-05', valor: 400 }] })
    expect([...lucroPorMesTodos([o])]).toEqual([['2026-09', 200], ['2026-10', 400]])
  })
  it('não depende da ordem em que as entradas chegam', () => {
    const e = [{ data: '2026-10-05', valor: 400 }, { data: '2026-08-10', valor: 600 }, { data: '2026-09-10', valor: 600 }]
    expect([...lucroPorMesTodos([op({ recebido: 1600, entradas: e })])]).toEqual([['2026-09', 200], ['2026-10', 400]])
  })
  it('com indicador, só a parte do dono; soma de operações no mesmo mês', () => {
    const a = op({ id: 1, pct: 0.5, recebido: 1200, entradas: [{ data: '2026-10-01', valor: 1200 }] })
    const b = op({ id: 2, recebido: 1100, entradas: [{ data: '2026-10-02', valor: 1100 }] })
    expect(lucroPorMesTodos([a, b]).get('2026-10')).toBe(200)
  })
  it('o total de todos os meses é igual ao lucro realizado da operação', () => {
    const o = op({ pct: 0.3, recebido: 1700, entradas: [{ data: '2026-07-01', valor: 700 }, { data: '2026-08-01', valor: 500 }, { data: '2026-09-01', valor: 500 }] })
    expect([...lucroPorMesTodos([o]).values()].reduce((s, x) => s + x, 0)).toBeCloseTo(lucroRealizado(o), 2)
  })
  it('só juros dividido: o total dos meses também fecha', () => {
    const o = op({ jurosRecebidos: 300, recebido: 600, pct: 0.5, entradas: [{ data: '2026-08-01', valor: 200 }, { data: '2026-09-01', valor: 400 }] })
    const m = lucroPorMesTodos([o])
    expect(m.get('2026-08')).toBe(50); expect(m.get('2026-09')).toBe(100)
  })
})

describe('relatórios montados', () => {
  const venda = op({ tipo: 'VENDA', id: 10, data: '2026-10-02', modelo: 'IPHONE 15', diasParado: 20, investido: 2000, total: 3000, lucroTotal: 1000, recebido: 2500, falta: 500, capitalDeVolta: 2000, entradas: [{ data: '2026-10-02', valor: 2500 }], parcelas: [{ vencimento: '2026-10-20', valor: 500, desconto: 0, pago: 0 }] })
  const emp = op({ id: 20, data: '2026-08-15', indicadorId: 7, pct: 0.5, recebido: 1400, falta: 100, capitalDeVolta: 1000, entradas: [{ data: '2026-09-15', valor: 1400 }], parcelas: [{ vencimento: '2026-09-15', valor: 1400, desconto: 0, pago: 1400 }, { vencimento: '2026-10-05', valor: 100, desconto: 0, pago: 0 }] })
  const r = montarRelatorios([venda, emp], extras({ caixa: 5000, estoque: 3000, aportes: 8000, repassesAPagar: 100, repassesFuturos: 50, indicadores: [{ id: 7, nome: 'Roberto' }, { id: 8, nome: 'Sem operação' }] }))

  it('resumo: lucro por mês na janela de 6 meses e por tipo', () => {
    expect(r.resumo.meses).toHaveLength(6)
    expect(r.resumo.lucroPorMes).toEqual([0, 0, 0, 0, 200, 500])
    expect(r.resumo.lucroIphones).toBe(500); expect(r.resumo.lucroEmprestimos).toBe(200)
    expect(r.resumo.modelos).toEqual([{ modelo: 'IPHONE 15', vendas: 1, lucroMedio: 1000, diasParado: 20 }])
  })
  it('investimento e lucro: investido no mês da operação, recebido no mês em que entrou', () => {
    expect(r.investimentoELucro.investido).toEqual([0, 0, 0, 1000, 0, 2000])
    expect(r.investimentoELucro.recebido).toEqual([0, 0, 0, 0, 1400, 2500])
    expect(r.investimentoELucro.iphones).toMatchObject({ investido: 2000, recebido: 2500, lucroNoBolso: 500, lucroPorVir: 500, retorno: 0.5 })
    expect(r.investimentoELucro.emprestimos).toMatchObject({ investido: 1000, recebido: 1400, lucroNoBolso: 200, lucroPorVir: 50, retorno: 0.25 })
  })
  it('capital: o que está na rua é o capital que ainda não voltou', () => {
    expect(r.capital).toMatchObject({ emCaixa: 5000, noEstoque: 3000, vendasNaRua: 0, emprestimosNaRua: 0, total: 8000 })
  })
  it('por indicador: Direto primeiro, indicador sem operação não aparece', () => {
    expect(r.porIndicador.map((l) => l.nome)).toEqual(['Direto', 'Roberto'])
    expect(r.porIndicador[0]).toMatchObject({ operacoes: 1, lucroTotal: 1000, parteDele: 0, suaParte: 1000 })
    expect(r.porIndicador[1]).toMatchObject({ indicadorId: 7, operacoes: 1, lucroTotal: 500, parteDele: 250, suaParte: 250 })
  })
  it('controle mensal: previsto, recebido e em atraso pelo mês do vencimento', () => {
    expect(r.controleMensal.map((m) => m.mes)).toEqual(janela(HOJE, -3, 3))
    expect(r.controleMensal.find((m) => m.mes === '2026-09')).toMatchObject({ previsto: 1400, recebido: 1400, emAtraso: 0 })
    expect(r.controleMensal.find((m) => m.mes === '2026-10')).toMatchObject({ previsto: 600, recebido: 0, emAtraso: 100 }) // 100 venceu dia 5; 500 vence dia 20
  })
  it('balancete: o que tem menos o que deve', () => {
    expect(r.balancete).toMatchObject({ caixa: 5000, estoque: 3000, aReceberVendas: 500, aReceberEmprestimos: 100, ativo: 8600, repassesAPagar: 100, parteFuturaIndicadores: 50, passivo: 150, patrimonio: 8450, aportes: 8000 })
  })
  it('saldo de caixa negativo não entra no capital, mas aparece no balancete', () => {
    const n = montarRelatorios([], extras({ caixa: -300 }))
    expect(n.capital.emCaixa).toBe(0); expect(n.balancete.caixa).toBe(-300); expect(n.balancete.patrimonio).toBe(-300)
  })
  it('sem nada: tudo zerado e sem dividir por zero', () => {
    const z = montarRelatorios([], extras())
    expect(z.investimentoELucro.iphones.retorno).toBe(0); expect(z.resumo.modelos).toEqual([]); expect(z.capital.total).toBe(0); expect(z.porIndicador).toHaveLength(1)
  })
  it('parcela com desconto que fecha não é atraso', () => {
    const o = op({ parcelas: [{ vencimento: '2026-10-01', valor: 100, desconto: 30, pago: 70 }] })
    expect(montarRelatorios([o], extras()).controleMensal.find((m) => m.mes === '2026-10')!.emAtraso).toBe(0)
  })
  it('atraso desconta o que já foi pago e o desconto', () => {
    const o = op({ parcelas: [{ vencimento: '2026-10-01', valor: 100, desconto: 30, pago: 20 }] })
    expect(montarRelatorios([o], extras()).controleMensal.find((m) => m.mes === '2026-10')!.emAtraso).toBe(50)
  })
  it('na rua: venda e empréstimo ativos somam em linhas separadas; quitada com prejuízo não deixa capital na rua', () => {
    const v = op({ tipo: 'VENDA', id: 1, investido: 2000, capitalDeVolta: 500 }), e = op({ id: 2, investido: 1000, capitalDeVolta: 100 })
    const q = op({ id: 3, status: 'QUITADA', investido: 1000, capitalDeVolta: 800, recebido: 800, lucroTotal: -200 })
    const r = montarRelatorios([v, e, q], extras()).capital
    expect(r.vendasNaRua).toBe(1500); expect(r.emprestimosNaRua).toBe(900)
  })
  it('por vir: quitada não tem lucro por vir, nem com parte do indicador', () => {
    const q = op({ status: 'QUITADA', pct: 0.5, recebido: 1200, falta: 0, lucroTotal: 500 }) // sobraram 150 de lucro previsto que não vai entrar (desconto)
    expect(montarRelatorios([q], extras()).investimentoELucro.emprestimos.lucroPorVir).toBe(0)
  })
  it('operação no prejuízo com indicador: a parte dele é zero', () => {
    const o = op({ indicadorId: 7, pct: 0.5, lucroTotal: -300 })
    expect(montarRelatorios([o], extras({ indicadores: [{ id: 7, nome: 'R' }] })).porIndicador[1]).toMatchObject({ lucroTotal: 0, parteDele: 0, suaParte: 0 })
  })
  it('modelo sem dias conhecidos mostra null (aparelho migrado)', () => {
    const o = op({ tipo: 'VENDA', modelo: 'IPHONE 12', diasParado: null })
    expect(montarRelatorios([o], extras()).resumo.modelos[0].diasParado).toBeNull()
  })
  it('modelos: mais vendas primeiro, depois maior lucro', () => {
    const a = op({ tipo: 'VENDA', id: 1, modelo: 'A', lucroTotal: 100 }), b = op({ tipo: 'VENDA', id: 2, modelo: 'B', lucroTotal: 900 }), c = op({ tipo: 'VENDA', id: 3, modelo: 'A', lucroTotal: 100 })
    expect(montarRelatorios([a, b, c], extras()).resumo.modelos.map((m) => m.modelo)).toEqual(['A', 'B'])
  })
})

describe('paridade com a demonstração do front', () => {
  it('o cenário combinado dá exatamente o resultado gravado (o front confere o mesmo arquivo)', () => {
    const f = JSON.parse(readFileSync(new URL('./fixtures/relatorios/paridade.json', import.meta.url), 'utf8'))
    expect(montarRelatorios(f.ops, f.extras)).toEqual(f.esperado)
  })
})
