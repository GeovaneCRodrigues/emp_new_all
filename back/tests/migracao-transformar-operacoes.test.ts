import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { EstadoAntigo, OperacaoAntiga, RecebimentoAntigo } from '../src/migracao/antigo/tipos.js'
import { transformarOperacao } from '../src/migracao/antigo/transformar-operacoes.js'

const HOJE = '2026-10-09'
const op = (o: Partial<OperacaoAntiga> = {}): OperacaoAntiga => ({
  id: 1, clienteId: 7, dataInicio: '2026-05-05', diaVencimento: 10, modalidade: 'PARCELADO', periodicidade: 'MENSAL', valorOriginal: 1500, taxaJurosMes: 0, valorRecebimentoMensal: 500,
  qtdeParcelasRecuperacao: 0, qtdeParcelasLucro: 4, percentualParceiro: 0, modoDivisaoParceiro: null, indicadorId: null, status: 'EM ANDAMENTO', obs: null, criadoEm: '2026-05-05T12:00:00Z', ...o,
})
let seq = 0
const rec = (parcelaId: string, valor: number, data: string, o: Partial<RecebimentoAntigo> = {}): RecebimentoAntigo => ({
  id: ++seq, parcelaId, operacaoId: 1, valor, tipo: 'integral', saldoRemanescente: 0, novaParcelaId: null, prazoDias: null, dataPagamento: data, obs: null, cobradoPor: 'OWNER', criadoEm: null, ...o,
})
const estado = (e: Partial<EstadoAntigo> = {}): EstadoAntigo => ({
  operacoes: [], recebimentos: [], parcelasExtras: [], parcelaAjustes: {}, parcelaVencimentos: {}, quitacoes: [], acordos: [], repassesBaixas: [], repassesPagamentos: [], transferencias: [], movimentacoesCaixa: [], ...e,
})
const ir = (o: OperacaoAntiga, e: Partial<EstadoAntigo> = {}) => transformarOperacao(o, estado({ operacoes: [o], ...e }), HOJE)
const novo = (o: OperacaoAntiga, e: Partial<EstadoAntigo> = {}) => { const r = ir(o, e); expect(r.erro).toBeUndefined(); return { ...r.novo!, avisos: r.avisos } }
const soma = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100

/** O que SEMPRE tem de valer: nenhum centavo recebido se perde nem aparece do nada. */
function conservaOsCentavos(e: ReturnType<typeof novo>, recebimentos: RecebimentoAntigo[]) {
  expect(soma(e.pagamentos.map((p) => p.valorTotal))).toBe(soma(recebimentos.map((r) => r.valor)))
  for (const p of e.pagamentos) expect(soma(p.itens.map((i) => i.valor))).toBe(p.valorTotal)
  expect(soma(e.parcelas.map((p) => p.pago))).toBe(soma(recebimentos.map((r) => r.valor)))
  for (const p of e.parcelas) expect(p.pago).toBeLessThanOrEqual(p.valor + 0.009) // nenhuma parcela fica paga além do valor
  expect(e.parcelas.map((p) => p.numero)).toEqual(e.parcelas.map((_, i) => i + 1)) // numeração contínua
}

describe('parcelado mensal', () => {
  const recs = [rec('1-1', 500, '2026-05-10'), rec('1-2', 500, '2026-06-10')]
  it('gera as 4 parcelas pela regra antiga e aloca os dois pagamentos', () => {
    const e = novo(op(), { recebimentos: recs })
    expect(e.parcelas.map((p) => [p.numero, p.vencimento, p.valor, p.pago])).toEqual([[1, '2026-05-10', 500, 500], [2, '2026-06-10', 500, 500], [3, '2026-07-10', 500, 0], [4, '2026-08-10', 500, 0]])
    expect(e.parcelas[0].quitadaEm).toBe('2026-05-10'); expect(e.parcelas[2].quitadaEm).toBeNull()
    expect(e).toMatchObject({ modalidade: 'PARCELADO', periodicidade: 'MENSAL', capital: 1500, status: 'ATIVA', pct: 0, modoDivisao: 'CAPITAL_PRIMEIRO', dataEmprestimo: '2026-05-05' })
    conservaOsCentavos(e, recs)
  })
  it('a taxa é o % de juros NO TOTAL: 4 × 500 sobre 1.500 = 33,3333%', () => { expect(novo(op()).taxa).toBe(33.3333) })
  it('cada recebimento vira um recibo com o resumo certo', () => {
    const e = novo(op(), { recebimentos: recs })
    expect(e.pagamentos[0].resumo).toEqual({ tipo: 'PARCELAS', referencia: 'parcela 1/4', faltaDepois: 1500, proxima: { numero: 2, valor: 500, vencimento: '2026-06-10' }, restantes: 3, ficaDevendo: null })
    expect(e.pagamentos[1].resumo).toMatchObject({ faltaDepois: 1000, restantes: 2, proxima: { numero: 3 } })
    expect(e.pagamentos[0].itens[0].antes).toEqual({ vencimento: '2026-05-10', vencimentoOriginal: null, desconto: 0, quitadaEm: null })
  })
  it('tudo pago: QUITADA', () => {
    const r = [1, 2, 3, 4].map((n) => rec(`1-${n}`, 500, `2026-0${n + 4}-10`))
    const e = novo(op({ status: 'QUITADO' }), { recebimentos: r })
    expect(e.status).toBe('QUITADA'); expect(e.avisos).not.toContain('status_antigo_diferente'); conservaOsCentavos(e, r)
  })
  it('o status do antigo diferente do calculado aparece como aviso', () => { expect(novo(op({ status: 'QUITADO' })).avisos).toContain('status_antigo_diferente') })
  it('os recebimentos são processados por data e depois por id, mesmo fora de ordem', () => {
    const r = [rec('1-2', 500, '2026-06-10'), rec('1-1', 500, '2026-05-10')]
    expect(novo(op(), { recebimentos: r }).pagamentos.map((p) => p.data)).toEqual(['2026-05-10', '2026-06-10'])
  })
  it('pagamento parcial sem saldo parcial no antigo: a parcela continua aberta com o que falta', () => {
    const r = [rec('1-3', 200, '2026-07-10', { tipo: 'parcial' })]
    const e = novo(op(), { recebimentos: r })
    expect(e.parcelas[2]).toMatchObject({ valor: 500, pago: 200 }); expect(e.pagamentos[0].resumo.ficaDevendo).toMatchObject({ numero: 3, valor: 300 }); conservaOsCentavos(e, r)
  })
  it('data remarcada: guarda a data original', () => {
    const e = novo(op(), { parcelaVencimentos: { '1-2': { vencimentoIso: '2026-06-25' } } })
    expect(e.parcelas[1]).toMatchObject({ vencimento: '2026-06-25', vencimentoOriginal: '2026-06-10' })
  })
})

describe('baixa parcial com saldo (o saldo vira a própria parcela, que segue aberta na data nova)', () => {
  const extras = [{ id: '1-1-spl-1', operacaoId: 1, parcelaOrigemId: '1-1', parcelaNumero: 1, totalParcelas: 3, vencimentoIso: '2026-06-20', valor: 300, fase: 'SALDO PROPORCIONAL', modalidade: 'PARCELADO' }]
  const base = (extra: Partial<EstadoAntigo> = {}) => ({ parcelaAjustes: { '1-1': { valorAjustado: 200, proporcional: true } }, parcelasExtras: extras, ...extra })
  it('uma parcela só (não duas): valor 500, pago 200, data nova, a original guardada', () => {
    const r = [rec('1-1', 200, '2026-05-10', { tipo: 'parcial', novaParcelaId: '1-1-spl-1', prazoDias: 41 })]
    const e = novo(op({ qtdeParcelasLucro: 3 }), { ...base(), recebimentos: r })
    expect(e.parcelas).toHaveLength(3)
    expect(e.parcelas[0]).toMatchObject({ numero: 1, valor: 500, pago: 200, vencimento: '2026-06-20', vencimentoOriginal: '2026-05-10', legacyParcelas: ['1-1', '1-1-spl-1'] })
    expect(e.pagamentos[0].resumo.ficaDevendo).toEqual({ numero: 1, valor: 300, vencimento: '2026-06-20' })
    expect(e.pagamentos[0].itens[0].antes.vencimento).toBe('2026-05-10') // para desfazer, a data volta
    expect(e.avisos).toContain('saldo_parcial_unido'); conservaOsCentavos(e, r)
  })
  it('o pagamento do saldo quita a parcela, na data em que foi pago', () => {
    const r = [rec('1-1', 200, '2026-05-10', { tipo: 'parcial', novaParcelaId: '1-1-spl-1' }), rec('1-1-spl-1', 300, '2026-06-20')]
    const e = novo(op({ qtdeParcelasLucro: 3 }), { ...base(), recebimentos: r })
    expect(e.parcelas[0]).toMatchObject({ pago: 500, quitadaEm: '2026-06-20' }); expect(e.pagamentos[1].resumo.ficaDevendo).toBeNull(); conservaOsCentavos(e, r)
  })
})

describe('diária', () => {
  const d = (o: Partial<OperacaoAntiga> = {}) => op({ periodicidade: 'DIARIA', dataInicio: '2026-09-01', qtdeParcelasLucro: 6, valorRecebimentoMensal: 100, valorOriginal: 500, ...o })
  it('vira DIARIA (parcelado com frequência diária no antigo) e mantém um dia de cada vez, domingo inclusive', () => {
    const e = novo(d())
    expect(e).toMatchObject({ modalidade: 'DIARIA', periodicidade: 'DIARIA' })
    expect(e.parcelas.map((p) => p.vencimento)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']) // 06/09/2026 é domingo
    expect(e.taxa).toBe(20) // 6 × 100 sobre 500
  })
  it('pagamento "da diária" (por saldo, sem parcela): é rateado nas primeiras parcelas em aberto', () => {
    const r = [rec('diaria-1', 250, '2026-09-04')]
    const e = novo(d(), { recebimentos: r })
    expect(e.parcelas.map((p) => p.pago)).toEqual([100, 100, 50, 0, 0, 0])
    expect(e.pagamentos[0].itens.map((i) => [i.numeroParcela, i.valor])).toEqual([[1, 100], [2, 100], [3, 50]])
    expect(e.pagamentos[0].resumo.referencia).toBe('parcelas 1 a 3 de 6')
    expect(e.avisos).toContain('diaria_saldo_rateado'); conservaOsCentavos(e, r)
  })
})

describe('só juros em aberto', () => {
  const j = (o: Partial<OperacaoAntiga> = {}) => op({ modalidade: 'JUROS', valorOriginal: 3000, valorRecebimentoMensal: 300, qtdeParcelasLucro: 0, taxaJurosMes: 0.1, ...o })
  const recs = [rec('1-1', 300, '2026-05-10'), rec('1-2', 300, '2026-06-10'), rec('1-3', 300, '2026-07-10')]
  it('o que já venceu + um ano à frente, com o capital na última parcela', () => {
    const e = novo(j(), { recebimentos: recs })
    // hoje 09/10: venceram as parcelas 1 a 5 (mai a set); +12 = 17 parcelas
    expect(e.parcelas).toHaveLength(17)
    expect(e.parcelas[0].valor).toBe(300); expect(e.parcelas[15].valor).toBe(300); expect(e.parcelas[16].valor).toBe(3300)
    expect(e).toMatchObject({ modalidade: 'JUROS', taxa: 10, capital: 3000, status: 'ATIVA' }) // 300 de 3.000 = 10% por parcela
    conservaOsCentavos(e, recs)
  })
  it('sem pagamento nenhum: as vencidas (5) + 12', () => { expect(novo(j()).parcelas).toHaveLength(17) })
  it('nunca passa do horizonte do antigo (24 mensais)', () => {
    const muitas = Array.from({ length: 20 }, (_, i) => rec(`1-${i + 1}`, 300, '2026-09-01'))
    expect(novo(j({ dataInicio: '2025-01-05' }), { recebimentos: muitas }).parcelas.length).toBeLessThanOrEqual(24)
  })
  it('quinzenal e semanal usam horizontes próprios (26 e 52)', () => {
    expect(novo(j({ periodicidade: 'QUINZENAL', dataInicio: '2026-10-01' })).parcelas).toHaveLength(1 + 26) // venceu a 1ª (01/10) + 26
    expect(novo(j({ periodicidade: 'SEMANAL', dataInicio: '2026-10-01' })).parcelas).toHaveLength(2 + 52) // 01/10 e 08/10
  })
  it('dividir a cada pagamento (JUROS_MENSAL) é levado para o empréstimo; em outra modalidade é ignorado com aviso', () => {
    expect(novo(j({ indicadorId: 2, percentualParceiro: 0.5, modoDivisaoParceiro: 'JUROS_MENSAL' })).modoDivisao).toBe('JUROS_MENSAL')
    const p = novo(op({ indicadorId: 2, percentualParceiro: 0.5, modoDivisaoParceiro: 'JUROS_MENSAL' }))
    expect(p.modoDivisao).toBe('CAPITAL_PRIMEIRO'); expect(p.avisos).toContain('divisao_juros_mensal_ignorada')
  })
  it('só juros com frequência diária não existe no novo: erro, não importa', () => { expect(ir(j({ periodicidade: 'DIARIA' })).erro).toMatch(/diária/) })
})

describe('só juros quitado (a quitação paga capital + juros de uma vez)', () => {
  const j = op({ modalidade: 'JUROS', periodicidade: 'QUINZENAL', valorOriginal: 2000, valorRecebimentoMensal: 400, qtdeParcelasLucro: 0 })
  const quit = { id: 1, recebimentoId: 0, operacaoId: 1, parcelaOrigemId: '1-3', valor: 2400, dataPagamento: '2026-06-02', obs: null }
  it('a parcela da quitação leva o que foi pago (2.400) e a operação fica QUITADA', () => {
    const r = [rec('1-1', 400, '2026-05-05'), rec('1-2', 400, '2026-05-19'), rec('1-3', 2400, '2026-06-02', { tipo: 'quitacao' })]
    const e = novo(op({ ...j, status: 'QUITADO' }), { recebimentos: r, quitacoes: [quit] })
    expect(e.parcelas.map((p) => [p.valor, p.pago])).toEqual([[400, 400], [400, 400], [2400, 2400]])
    expect(e.status).toBe('QUITADA'); expect(e.capital).toBe(2000); conservaOsCentavos(e, r)
  })
  it('as parcelas que a quitação "pagou" sem dinheiro somem (era juro absorvido), com aviso', () => {
    const r = [rec('1-1', 400, '2026-05-05'), rec('1-3', 2400, '2026-06-02', { tipo: 'quitacao' })]
    const e = novo(op({ ...j, status: 'QUITADO' }), { recebimentos: r, quitacoes: [quit] })
    expect(e.parcelas).toHaveLength(2); expect(e.parcelas.map((p) => p.valor)).toEqual([400, 2400])
    expect(e.avisos).toContain('quitacao_parcelas_absorvidas'); conservaOsCentavos(e, r)
  })
})

describe('acordo', () => {
  const acordo = { id: 1, operacaoId: 1, valorTotal: 1200, capitalAdicional: 0, qtdeParcelas: 3, valorParcela: 400, dataPrimeiraParcela: '2026-08-15', diaVencimento: 15, periodicidade: 'MENSAL' as const, dataAcordo: '2026-08-01', obs: 'perdeu o emprego' }
  const ex = (n: number) => ({ id: `acordo-1-${n}`, operacaoId: 1, parcelaOrigemId: '1-1', parcelaNumero: n, totalParcelas: 3, vencimentoIso: `2026-0${7 + n}-15`, valor: 400, fase: 'ACORDO', modalidade: 'PARCELADO' })
  const recs = [rec('1-1', 500, '2026-05-10'), rec('1-2', 500, '2026-06-10'), rec('1-3', 200, '2026-07-10', { tipo: 'parcial' }), rec('acordo-1-1', 400, '2026-08-15')]
  const e0 = () => novo(op({ qtdeParcelasLucro: 6, valorOriginal: 2000 }), { recebimentos: recs, parcelasExtras: [ex(1), ex(2), ex(3)], acordos: [acordo] })
  it('ficam as parcelas pagas, a parcial e as do acordo (numeração contínua); o não pago some', () => {
    const e = e0()
    expect(e.parcelas.map((p) => [p.numero, p.valor, p.pago, p.acordoLegacyId])).toEqual([[1, 500, 500, null], [2, 500, 500, null], [3, 500, 200, null], [4, 400, 400, 1], [5, 400, 0, 1], [6, 400, 0, 1]])
    conservaOsCentavos(e, recs)
  })
  it('o acordo guarda o saldo de antes e as parcelas substituídas', () => {
    const a = e0().acordo!
    expect(a).toMatchObject({ legacyId: 1, dataAcordo: '2026-08-01', valorTotal: 1200, nParcelas: 3, primeiraParcela: '2026-08-15', motivo: 'perdeu o emprego' })
    expect(a.parcelasAntes.map((p) => p.numero)).toEqual([4, 5, 6]); expect(a.saldoAntes).toBe(1500 + 300) // 3 parcelas de 500 + o que faltou na 3ª
  })
  it('o capital que o acordo reforçou entra no capital emprestado', () => {
    const e = novo(op({ qtdeParcelasLucro: 6, valorOriginal: 2000 }), { recebimentos: recs, parcelasExtras: [ex(1), ex(2), ex(3)], acordos: [{ ...acordo, capitalAdicional: 5000 }] })
    expect(e.capital).toBe(7000); expect(e.avisos).toContain('capital_adicional_do_acordo')
  })
  it('só juros com acordo vira parcelas comuns: sem capital escondido na última', () => {
    const j = op({ modalidade: 'JUROS', valorOriginal: 3000, valorRecebimentoMensal: 300, qtdeParcelasLucro: 0 })
    const e = novo(j, { recebimentos: [rec('1-1', 300, '2026-05-10')], parcelasExtras: [ex(1), ex(2), ex(3)], acordos: [acordo] })
    expect(e.parcelas.map((p) => p.valor)).toEqual([300, 400, 400, 400])
  })
})

describe('casos de borda e segurança dos centavos', () => {
  it('pagamento acima do que falta na parcela: o excedente segue para as próximas (nada se perde)', () => {
    const r = [rec('1-1', 700, '2026-05-10')]
    const e = novo(op(), { recebimentos: r })
    expect(e.parcelas.map((p) => p.pago)).toEqual([500, 200, 0, 0]); expect(e.avisos).toContain('recebimento_dividido'); conservaOsCentavos(e, r)
  })
  it('pagamento em parcela já cheia vai para a próxima aberta', () => {
    const r = [rec('1-1', 500, '2026-05-10'), rec('1-1', 100, '2026-05-11')]
    const e = novo(op(), { recebimentos: r })
    expect(e.parcelas.map((p) => p.pago)).toEqual([500, 100, 0, 0]); conservaOsCentavos(e, r)
  })
  it('recebimento de parcela que não existe mais: rateado nas abertas, com aviso', () => {
    const r = [rec('1-99', 300, '2026-05-10')]
    const e = novo(op(), { recebimentos: r })
    expect(e.parcelas[0].pago).toBe(300); expect(e.avisos).toContain('recebimento_realocado'); conservaOsCentavos(e, r)
  })
  it('recebeu mais do que a operação inteira: a última parcela cresce para guardar o excedente (nada se perde)', () => {
    const r = [rec('1-1', 2300, '2026-05-10')]
    const e = novo(op(), { recebimentos: r })
    expect(e.avisos).toContain('recebimento_excedente'); expect(e.parcelas[3].valor).toBe(800); conservaOsCentavos(e, r)
  })
  it('cobrado pelo indicador: guarda quem cobrou; cobrado pela loja: ninguém', () => {
    const e = novo(op({ indicadorId: 3, percentualParceiro: 0.5 }), { recebimentos: [rec('1-1', 500, '2026-05-10', { cobradoPor: 'INDICADOR' }), rec('1-2', 500, '2026-06-10')] })
    expect(e.pagamentos.map((p) => p.cobradoPorIndicadorLegacyId)).toEqual([3, null])
  })
  it('o % do indicador: sem indicador é zero; com indicador fica o da operação (limitado a 0–100%)', () => {
    expect(novo(op({ percentualParceiro: 0.4 })).pct).toBe(0) // sem indicador, não conta
    expect(novo(op({ indicadorId: 1, percentualParceiro: 0.5 })).pct).toBe(0.5)
    expect(novo(op({ indicadorId: 1, percentualParceiro: 5 })).pct).toBe(1)
  })
  it('investimento/sociedade vira parcelado de 6 parcelas iguais, com aviso', () => {
    const e = novo(op({ modalidade: 'INVESTIMENTO/SOCIEDADE', qtdeParcelasRecuperacao: 3, qtdeParcelasLucro: 3, valorRecebimentoMensal: 400, valorOriginal: 2000 }))
    expect(e).toMatchObject({ modalidade: 'PARCELADO', periodicidade: 'MENSAL' }); expect(e.parcelas).toHaveLength(6); expect(e.parcelas.every((p) => p.valor === 400)).toBe(true)
    expect(e.taxa).toBe(20); expect(e.avisos).toContain('investimento_como_parcelado') // 6 × 400 sobre 2.000
  })
  it('operação sem parcelas (sem valor de parcela): erro, não importa', () => { expect(ir(op({ valorRecebimentoMensal: 0 })).erro).toMatch(/parcelas/) })
  it('capital zero não quebra a taxa', () => { expect(novo(op({ valorOriginal: 0 })).taxa).toBe(0) })
  it('observação e data de criação seguem', () => { expect(novo(op({ obs: '  nota  ' }))).toMatchObject({ observacoes: 'nota', criadoEm: '2026-05-05T12:00:00Z' }) })
})

describe('conservação em TODOS os cenários do código antigo (os mesmos da paridade)', () => {
  type Caso = { nome: string; entrada: { operacoes: OperacaoAntiga[]; recebimentos: RecebimentoAntigo[]; parcelasExtras: EstadoAntigo['parcelasExtras']; parcelaAjustes: EstadoAntigo['parcelaAjustes']; quitacoes: EstadoAntigo['quitacoes']; parcelaVencimentos: Record<string, { vencimentoIso: string }>; acordos: EstadoAntigo['acordos'] } }
  const casos = JSON.parse(readFileSync(new URL('./fixtures/migracao/cronograma-golden.json', import.meta.url), 'utf8')) as Caso[]
  for (const c of casos) {
    it(c.nome, () => {
      const e = estado({ ...c.entrada, recebimentos: c.entrada.recebimentos.map((r) => ({ ...({ cobradoPor: 'OWNER', saldoRemanescente: 0, novaParcelaId: null, prazoDias: null, obs: null, criadoEm: null } as Partial<RecebimentoAntigo>), ...r })) as RecebimentoAntigo[] })
      for (const o of c.entrada.operacoes) {
        const r = transformarOperacao({ ...({ qtdeParcelasRecuperacao: 0, taxaJurosMes: 0, percentualParceiro: 0, modoDivisaoParceiro: null, indicadorId: null, status: 'EM ANDAMENTO', obs: null, criadoEm: null, clienteId: 1 } as Partial<OperacaoAntiga>), ...o } as OperacaoAntiga, e, HOJE)
        if (r.erro) continue // operação sem parcela: não importa
        conservaOsCentavos({ ...r.novo!, avisos: r.avisos }, e.recebimentos.filter((x) => x.operacaoId === o.id))
      }
    })
  }
})
