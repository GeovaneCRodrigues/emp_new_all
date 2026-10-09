import { addDia, pulaDomingo, somaDiasUteis, somaMes } from '../../../shared/datas.js'
import { arred2, ceilCent } from '../../vendas/services/calculo.js'
import type { ModalidadeEmprestimo, Periodicidade } from '../models/types.js'

export type EntradaPlano = { capital: number; modalidade: ModalidadeEmprestimo; taxa: number; n: number; data: string; periodicidade: Periodicidade; primeira?: string }
export type ItemPlano = { vencimento: string; valor: number }

export const NOME_PERIODICIDADE: Record<Periodicidade, string> = { MENSAL: 'mensal', QUINZENAL: 'quinzenal', SEMANAL: 'semanal', DIARIA: 'diária' }

/** 1º vencimento padrão: um período depois da data do empréstimo (no mensal, o mesmo dia do mês seguinte). */
export function primeiroVencimentoPadrao(data: string, periodicidade: Periodicidade): string {
  if (periodicidade === 'QUINZENAL') return addDia(data, 15)
  if (periodicidade === 'SEMANAL') return addDia(data, 7)
  if (periodicidade === 'DIARIA') return somaDiasUteis(data, 1)
  return somaMes(data, 1, Number(data.slice(8, 10)))
}

/**
 * Datas das parcelas. Mensal: o mesmo dia do mês do 1º vencimento (limitado ao fim do mês); quinzenal: de 15 em 15
 * dias; semanal: de 7 em 7; diária: todo dia menos domingo (se o 1º cair no domingo, vai para a segunda).
 */
export function vencimentosDoPlano(primeira: string, periodicidade: Periodicidade, n: number, diaMensal = Number(primeira.slice(8, 10))): string[] {
  if (periodicidade === 'DIARIA') {
    const p0 = pulaDomingo(primeira)
    return Array.from({ length: n }, (_, i) => (i ? somaDiasUteis(p0, i) : p0))
  }
  const passo = periodicidade === 'QUINZENAL' ? 15 : periodicidade === 'SEMANAL' ? 7 : 0
  return Array.from({ length: n }, (_, i) => (passo ? addDia(primeira, passo * i) : somaMes(primeira, i, diaMensal)))
}

/**
 * Parcelas de um empréstimo.
 *  - PARCELADO e DIARIA: o juro é % NO TOTAL (100% = o cliente paga o dobro), dividido nas parcelas.
 *    parcela = ceil(capital × (1 + taxa%) ÷ n). Ex.: 3.000 a 30% em 6x → 6 × 650,00.
 *  - JUROS: a cada parcela o cliente paga só o juro (capital × taxa%); o capital vem junto na última.
 */
export function planoEmprestimo(a: EntradaPlano): ItemPlano[] {
  const t = a.taxa / 100
  // sem 1º vencimento escolhido, o dia do mês é o do empréstimo (31/01 → 28/02, 31/03, 30/04…); escolhido, vale o dia dele
  const venc = a.primeira ? vencimentosDoPlano(a.primeira, a.periodicidade, a.n) : vencimentosDoPlano(primeiroVencimentoPadrao(a.data, a.periodicidade), a.periodicidade, a.n, Number(a.data.slice(8, 10)))
  if (a.modalidade === 'JUROS') {
    const juro = arred2(a.capital * t)
    return venc.map((vencimento, i) => ({ vencimento, valor: arred2(juro + (i === a.n - 1 ? a.capital : 0)) }))
  }
  const parcela = ceilCent((a.capital * (1 + t)) / a.n)
  return venc.map((vencimento) => ({ vencimento, valor: parcela }))
}

export const totalDoPlano = (p: ItemPlano[]) => arred2(p.reduce((s, x) => s + x.valor, 0))
