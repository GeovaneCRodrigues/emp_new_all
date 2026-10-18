import { addDia, pulaDomingo, somaDiasUteis, somaMes } from './datas'
import { arred2 } from './format'
import type { Iso } from './types'

export const ACORDO_MAX_PARCELAS = 240

/** Divide o total em n parcelas: as primeiras com o valor arredondado para baixo e a última com o resto (a soma fecha no centavo). */
export function distribuirAcordo(total: number, n: number): number[] {
  if (!(n >= 1) || !(total > 0)) return []
  const base = Math.floor((total / n) * 100) / 100
  const valores = Array.from({ length: n - 1 }, () => base)
  valores.push(arred2(total - base * (n - 1)))
  return valores
}

export type PeriodicidadeAcordo = 'MENSAL' | 'QUINZENAL' | 'SEMANAL' | 'DIARIA'
export const PERIODICIDADES_ACORDO: { valor: PeriodicidadeAcordo; rotulo: string; ajuda: string }[] = [
  { valor: 'MENSAL', rotulo: 'Mensal', ajuda: 'As outras vencem mês a mês, no mesmo dia.' },
  { valor: 'QUINZENAL', rotulo: 'Quinzenal', ajuda: 'As outras vencem a cada 14 dias.' },
  { valor: 'SEMANAL', rotulo: 'Semanal', ajuda: 'As outras vencem a cada 7 dias.' },
  { valor: 'DIARIA', rotulo: 'Diária (seg a sáb)', ajuda: 'As outras vencem todo dia, de segunda a sábado (domingo não conta).' },
]

/** Os vencimentos das parcelas: mensal no dia da 1ª (limitado ao fim do mês), quinzenal, semanal, ou diária de segunda a sábado. */
export const vencimentosAcordo = (primeira: Iso, n: number, periodicidade: PeriodicidadeAcordo = 'MENSAL'): Iso[] => Array.from({ length: n }, (_, i) =>
  periodicidade === 'SEMANAL' ? addDia(primeira, 7 * i)
  : periodicidade === 'QUINZENAL' ? addDia(primeira, 14 * i)
  : periodicidade === 'DIARIA' ? somaDiasUteis(pulaDomingo(primeira), i)
  : somaMes(primeira, i, Number(primeira.slice(8, 10))))

/** O valor sugerido do acordo: o que ele devia + o dinheiro novo emprestado + o juro cobrado sobre esse dinheiro (tudo em reais). */
export const valorSugeridoAcordo = (saldo: number, dinheiroNovo: number, jurosDoNovo: number): number => arred2(saldo + Math.max(0, dinheiroNovo) + Math.max(0, jurosDoNovo))

/** Valida a proposta do acordo (a mesma regra do backend). Devolve a mensagem do problema, ou '' se está tudo certo. */
export function problemaDoAcordo(a: { valorTotal: number; parcelas: number; primeiraParcela: Iso; capitalAdicional?: number }, hoje: Iso): string {
  if (a.capitalAdicional !== undefined && (!Number.isFinite(a.capitalAdicional) || a.capitalAdicional < 0 || a.capitalAdicional > 1e8)) return 'Dinheiro novo: informe um valor válido (zero ou mais).'
  if (!(a.valorTotal > 0) || a.valorTotal > 1e8) return 'Informe o valor do acordo.'
  if (!Number.isInteger(a.parcelas) || a.parcelas < 1 || a.parcelas > ACORDO_MAX_PARCELAS) return `Parcelas: de 1 a ${ACORDO_MAX_PARCELAS}.`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.primeiraParcela)) return 'Informe a data da 1ª parcela.'
  if (a.primeiraParcela < hoje) return 'A 1ª parcela não pode ser numa data que já passou.'
  if (a.primeiraParcela > addDia(hoje, 366)) return 'A 1ª parcela não pode passar de um ano.'
  if (arred2(a.valorTotal) / a.parcelas < 0.01) return 'O valor é pequeno demais para essa quantidade de parcelas.'
  return ''
}

/** A conta de unificar vários empréstimos: o que ele deve em todos e o capital inteiro (passa para o novo, junto com o que já foi pago). */
export function resumoUnificacao(emps: { falta: number; capital?: number }[]): { saldo: number; capital: number } {
  return {
    saldo: arred2(emps.reduce((x, e) => x + e.falta, 0)),
    capital: arred2(emps.reduce((x, e) => x + (e.capital ?? 0), 0)),
  }
}

/** Os empréstimos têm o mesmo indicador (e o mesmo %)? Se sim, o novo herda; se não, o administrador escolhe. */
export function indicadoresDiferentes(emps: { indicador?: { id: number; nome: string } | null; percentualIndicador?: number }[]): boolean {
  return new Set(emps.map((e) => `${e.indicador?.id ?? 'x'}|${e.percentualIndicador ?? 0}`)).size > 1
}
