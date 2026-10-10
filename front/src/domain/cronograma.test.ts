import { describe, expect, it } from 'vitest'
import type { CobrancaApi } from '@/api/recebimentos'
import { gradeDoMes, kfmt, mesLabel, mesNome, resumoDoMes, somaYm } from './cronograma'

const HOJE = '2026-10-15'
let n = 0
const c = (vencimento: string, valor: number, pago = 0, o: Partial<CobrancaApi> = {}): CobrancaApi => ({
  tipo: 'VENDA', operacaoId: ++n, parcela: 1, nParcelas: 4, vencimento, vencimentoOriginal: null, valor, pago, falta: Math.max(0, Math.round((valor - pago) * 100) / 100), atrasoDias: 0,
  cliente: { id: 1, nome: 'ANA', fone: '' }, aparelho: 'iPhone', ultimaTransacaoId: null, ultimoRecebimentoEm: null, baixaPendente: null, ...o,
})

describe('rótulos e valores curtos', () => {
  it('mês por extenso', () => { expect(mesLabel('2026-10')).toBe('outubro 2026'); expect(mesNome('2026-03')).toBe('março') })
  it('soma meses atravessando o ano', () => { expect(somaYm('2026-12', 1)).toBe('2027-01'); expect(somaYm('2026-01', -1)).toBe('2025-12'); expect(somaYm('2026-10', 0)).toBe('2026-10') })
  it('valor curto: abaixo de mil inteiro, acima em k com uma casa', () => {
    expect(kfmt(0)).toBe('0'); expect(kfmt(850.4)).toBe('850'); expect(kfmt(999.6)).toBe('1000'); expect(kfmt(1000)).toBe('1k'); expect(kfmt(1250)).toBe('1,3k'); expect(kfmt(12000)).toBe('12k')
  })
})

describe('resumo do mês', () => {
  it('previsto = tudo que vence; recebido = o que já entrou; atraso = o que falta no que já venceu', () => {
    const r = resumoDoMes([c('2026-10-01', 200, 200), c('2026-10-10', 300), c('2026-10-12', 400, 150), c('2026-10-20', 500)], HOJE)
    expect(r).toEqual({ previsto: 1400, recebido: 350, atrasado: 550 }) // 300 + 250 faltando em dias já passados
  })
  it('o que vence hoje ainda não é atraso', () => { expect(resumoDoMes([c('2026-10-15', 300)], HOJE).atrasado).toBe(0) })
  it('parcela paga em dia passado não é atraso', () => { expect(resumoDoMes([c('2026-10-01', 200, 200)], HOJE).atrasado).toBe(0) })
  it('mês sem parcelas: tudo zero', () => { expect(resumoDoMes([], HOJE)).toEqual({ previsto: 0, recebido: 0, atrasado: 0 }) })
  it('centavos não acumulam erro de ponto flutuante', () => { expect(resumoDoMes([c('2026-10-01', 0.1), c('2026-10-02', 0.2)], HOJE).previsto).toBe(0.3) })
})

describe('grade do mês', () => {
  it('outubro de 2026 começa numa quinta (4 vazios) e tem 31 dias', () => {
    const g = gradeDoMes('2026-10', [], HOJE)
    expect(g.vazios).toBe(4); expect(g.dias).toHaveLength(31); expect(g.dias[0].iso).toBe('2026-10-01'); expect(g.dias[30].iso).toBe('2026-10-31')
  })
  it('fevereiro bissexto tem 29 dias; domingo no dia 1º não deixa vazio', () => {
    expect(gradeDoMes('2028-02', [], HOJE).dias).toHaveLength(29); expect(gradeDoMes('2026-02', [], HOJE).dias).toHaveLength(28)
    expect(gradeDoMes('2026-03', [], HOJE).vazios).toBe(0) // 1º de março de 2026 é domingo
  })
  it('agrupa as parcelas no dia certo e ignora as de outros meses', () => {
    const g = gradeDoMes('2026-10', [c('2026-10-10', 100), c('2026-10-10', 200), c('2026-11-10', 999), c('2026-09-30', 999)], HOJE)
    expect(g.dias[9].itens).toHaveLength(2); expect(g.dias[9].total).toBe(300); expect(g.dias.reduce((s, d) => s + d.itens.length, 0)).toBe(2)
  })
  it('dia sem parcela: sem cor e total zero', () => { const d = gradeDoMes('2026-10', [], HOJE).dias[4]; expect(d.cor).toBeNull(); expect(d.total).toBe(0) })
  it('cor: vermelho se aberto e já passou', () => { expect(gradeDoMes('2026-10', [c('2026-10-10', 100)], HOJE).dias[9].cor).toBe('bad') })
  it('cor: laranja se vence hoje, ou nos próximos 7 dias (inclusive o 7º)', () => {
    const g = gradeDoMes('2026-10', [c('2026-10-15', 1), c('2026-10-22', 1), c('2026-10-23', 1)], HOJE)
    expect(g.dias[14].cor).toBe('warn'); expect(g.dias[21].cor).toBe('warn'); expect(g.dias[22].cor).toBe('dim')
  })
  it('cor: cinza para aberto mais longe; verde quando tudo do dia foi pago', () => {
    const g = gradeDoMes('2026-10', [c('2026-10-30', 100), c('2026-10-02', 100, 100)], HOJE)
    expect(g.dias[29].cor).toBe('dim'); expect(g.dias[1].cor).toBe('ok')
  })
  it('dia misto (uma paga, outra aberta e vencida): vermelho; o total soma o que falta na aberta e o pago na quitada', () => {
    const d = gradeDoMes('2026-10', [c('2026-10-05', 100, 100), c('2026-10-05', 300, 50)], HOJE).dias[4]
    expect(d.cor).toBe('bad'); expect(d.total).toBe(100 + 250)
  })
  it('parcela quitada com desconto: o dia mostra o que foi PAGO (não o valor cheio) e fica verde', () => {
    const d = gradeDoMes('2026-10', [c('2026-10-03', 1368, 1000, { falta: 0 })], HOJE).dias[2]
    expect(d.total).toBe(1000); expect(d.cor).toBe('ok')
  })
  it('sobra de meio centavo não conta como em aberto (parcela paga continua verde e fora do atraso)', () => {
    const resto = c('2026-10-03', 100, 99.995, { falta: 0.005 })
    expect(gradeDoMes('2026-10', [resto], HOJE).dias[2].cor).toBe('ok'); expect(resumoDoMes([resto], HOJE).atrasado).toBe(0)
  })
  it('mês futuro: tudo cinza, nada vermelho; mês passado: aberto é vermelho', () => {
    expect(gradeDoMes('2026-12', [c('2026-12-01', 100)], HOJE).dias[0].cor).toBe('dim')
    expect(gradeDoMes('2026-08', [c('2026-08-31', 100)], HOJE).dias[30].cor).toBe('bad')
  })
})
