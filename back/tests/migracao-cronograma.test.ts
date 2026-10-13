import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gerarCronogramaAntigo, somarDias, vencimentoDaParcela } from '../src/migracao/antigo/cronograma.js'
import type { ParcelaAntiga } from '../src/migracao/antigo/tipos.js'

// Paridade: os casos em tests/fixtures/migracao/cronograma-golden.json foram gerados rodando o código ORIGINAL do sistema antigo
// (backend/src/utils/cronogramaService.js). O porte tem de dar exatamente o mesmo resultado.
type Caso = { nome: string; entrada: Parameters<typeof gerarCronogramaAntigo>[0]; esperado: Record<string, unknown>[] }
const casos = JSON.parse(readFileSync(new URL('./fixtures/migracao/cronograma-golden.json', import.meta.url), 'utf8')) as Caso[]

const normalizar = (p: ParcelaAntiga) => ({
  id: p.id, operacaoId: p.operacaoId, numero: p.numero, totalParcelas: p.totalParcelas, vencimentoIso: p.vencimentoIso, vencimentoOriginalIso: p.vencimentoOriginalIso ?? null, valor: p.valor, fase: p.fase,
  status: p.status === 'VENCIDO' || p.status === 'A_VENCER' ? 'ABERTO' : p.status, valorPago: p.valorPago, valorFalta: p.valorFalta, quitacaoOperacao: p.quitacaoOperacao ?? null,
})

describe('o cronograma portado dá o MESMO resultado do código antigo', () => {
  it('há casos suficientes para valer como prova', () => { expect(casos.length).toBeGreaterThanOrEqual(12) })
  for (const c of casos) {
    it(c.nome, () => {
      const r = gerarCronogramaAntigo({ ...c.entrada, hoje: '2026-10-09' } as never).map(normalizar)
      expect(r).toEqual(c.esperado)
    })
  }
  it('o resultado não depende de "hoje" além de VENCIDO x A_VENCER', () => {
    for (const c of casos) {
      const a = gerarCronogramaAntigo({ ...c.entrada, hoje: '2020-01-01' } as never).map(normalizar)
      const b = gerarCronogramaAntigo({ ...c.entrada, hoje: '2099-01-01' } as never).map(normalizar)
      expect(a).toEqual(b)
    }
  })
})

describe('datas', () => {
  it('somar dias atravessa mês e ano', () => { expect(somarDias('2026-12-30', 3)).toBe('2027-01-02'); expect(somarDias('2026-02-27', 2)).toBe('2026-03-01') })
  it('mensal respeita o fim do mês: dia 31 em fevereiro e abril', () => {
    expect(vencimentoDaParcela('2026-01-15', 31, 1, 'MENSAL')).toBe('2026-02-28')
    expect(vencimentoDaParcela('2026-01-15', 31, 3, 'MENSAL')).toBe('2026-04-30')
    expect(vencimentoDaParcela('2028-01-15', 31, 1, 'MENSAL')).toBe('2028-02-29') // bissexto
  })
  it('a 1ª parcela mensal é no mês do início, no dia combinado (não um mês depois)', () => {
    expect(vencimentoDaParcela('2026-05-05', 10, 0, 'MENSAL')).toBe('2026-05-10')
    expect(vencimentoDaParcela('2026-05-20', 10, 0, 'MENSAL')).toBe('2026-05-10') // antes do início, como no antigo
  })
  it('semanal, quinzenal e diária: a 1ª parcela é no próprio dia do início', () => {
    expect(vencimentoDaParcela('2026-05-05', 10, 0, 'SEMANAL')).toBe('2026-05-05')
    expect(vencimentoDaParcela('2026-05-05', 10, 2, 'QUINZENAL')).toBe('2026-06-02')
    expect(vencimentoDaParcela('2026-05-05', 10, 3, 'DIARIA')).toBe('2026-05-08')
  })
  it('periodicidade desconhecida vira mensal', () => { expect(vencimentoDaParcela('2026-05-05', 10, 1, 'XYZ')).toBe('2026-06-10') })
})
