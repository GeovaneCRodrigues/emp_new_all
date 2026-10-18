import { describe, expect, it } from 'vitest'
import type { EmprestimoApi } from '@/api/emprestimos'
import type { PagamentoApi } from '@/api/recebimentos'
import { detalhamentoEmprestimo } from './detalhamento'

const parc = (numero: number, vencimento: string, valor: number, pago: number, acordo: 'ENCERRADA' | null = null) =>
  ({ numero, vencimento, vencimentoOriginal: null, valor, desconto: 0, pago, falta: Math.max(0, valor - pago), quitadaEm: pago >= valor ? vencimento : null, acordo }) as EmprestimoApi['parcelas'][number]
const pag = (id: number, data: string, valor: number, forma: 'PIX' | 'DINHEIRO' = 'PIX', desfeita = false) =>
  ({ transacaoId: id, numero: String(id), data, forma, valor, recebidoPor: 'x', referencia: '', tipo: 'PARCELA', desfeita, podeDesfazer: false }) as PagamentoApi
const emp = (parcelas: EmprestimoApi['parcelas']): EmprestimoApi => {
  const ativas = parcelas.filter((p) => p.acordo !== 'ENCERRADA')
  return {
    id: 1, cliente: { id: 1, nome: 'ANILDO (ZEZÉ) UBER' }, modalidade: 'DIARIA', periodicidade: 'DIARIA', pulaDomingo: true, dataEmprestimo: '2026-09-01', observacoes: null, nParcelas: ativas.length, valorParcela: 200,
    total: ativas.reduce((x, p) => x + p.valor, 0), recebido: ativas.reduce((x, p) => x + p.pago, 0), falta: ativas.reduce((x, p) => x + p.falta, 0), atrasadas: 0, status: 'ATIVA', parcelas,
    capital: 7800, taxa: 100, lucroTotal: 999, seuLucro: 888, parteIndicador: 777, indicador: { id: 6, nome: 'DEDA' }, percentualIndicador: 0.5,
  } as EmprestimoApi
}
const base = emp([parc(1, '2026-10-15', 100, 100), parc(2, '2026-10-16', 100, 40), parc(3, '2026-10-19', 200, 0), parc(4, '2026-10-20', 200, 0), parc(5, '2026-10-21', 200, 0, 'ENCERRADA')])
const pagamentos = [pag(2, '2026-10-16', 40), pag(1, '2026-10-15', 100, 'DINHEIRO'), pag(3, '2026-10-17', 50, 'PIX', true)]

describe('detalhamento para o cliente', () => {
  it('simplificado: pago, falta, atraso e próxima parcela; nunca capital, lucro nem indicador', () => {
    const t = detalhamentoEmprestimo(base, pagamentos, '2026-10-18', 'SIMPLES')
    expect(t).toContain('Olá, Anildo!')
    expect(t).toContain('Já pago: R$ 140,00 (1 parcela)')
    expect(t).toContain('Falta pagar: R$ 460,00')
    expect(t).toContain('Em atraso: 1 parcela · R$ 60,00 (a mais antiga venceu em 16/10, há 2 dias)')
    expect(t).toContain('Próxima parcela: 19/10/2026 · R$ 200,00')
    expect(t).not.toMatch(/Pagamentos recebidos|Parcelas em aberto/)
    expect(t).not.toMatch(/capital|lucro|indicador|DEDA|7\.800|999|888|777/i)
  })
  it('extenso: lista os pagamentos (sem o desfeito) e as parcelas em aberto, ignorando as encerradas por acordo', () => {
    const t = detalhamentoEmprestimo(base, pagamentos, '2026-10-18', 'EXTENSO')
    expect(t).toContain('*Pagamentos recebidos*')
    expect(t).toContain('• 15/10/2026 · R$ 100,00 (dinheiro)')
    expect(t).toContain('• 16/10/2026 · R$ 40,00 (Pix)')
    expect(t).not.toContain('17/10/2026')
    expect(t).toContain('• 16/10/2026 · R$ 60,00 (atrasada)')
    expect(t).toContain('• 20/10/2026 · R$ 200,00')
    expect(t).not.toContain('21/10/2026')
  })
  it('quitado: agradece e não fala de falta', () => {
    const t = detalhamentoEmprestimo(emp([parc(1, '2026-10-15', 100, 100)]), [pag(1, '2026-10-15', 100)], '2026-10-18', 'SIMPLES')
    expect(t).toContain('Tudo quitado')
    expect(t).not.toContain('Falta pagar')
  })
  it('lista longa é cortada: últimos 40 pagamentos e as próximas 12 parcelas', () => {
    const ps = Array.from({ length: 100 }, (_, i) => parc(i + 1, `2027-01-${String((i % 28) + 1).padStart(2, '0')}`, 100, i < 60 ? 100 : 0))
    const pgs = Array.from({ length: 60 }, (_, i) => pag(i + 1, `2026-12-${String((i % 28) + 1).padStart(2, '0')}`, 100))
    const t = detalhamentoEmprestimo(emp(ps), pgs, '2026-12-31', 'EXTENSO')
    expect(t).toContain('… e mais 20 pagamentos anteriores')
    expect(t.split('\n').filter((x) => x.startsWith('• ')).length).toBe(40 + 12)
    expect(t).toMatch(/… e mais 28 parcelas, até/)
  })
})
