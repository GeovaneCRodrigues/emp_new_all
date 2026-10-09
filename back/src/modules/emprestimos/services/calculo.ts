import { somaMes } from '../../../shared/datas.js'
import { arred2, ceilCent } from '../../vendas/services/calculo.js'
import type { ModalidadeEmprestimo } from '../models/types.js'

export type EntradaPlano = { capital: number; modalidade: ModalidadeEmprestimo; taxa: number; n: number; data: string }
export type ItemPlano = { vencimento: string; valor: number }

/**
 * Parcelas de um empréstimo. O dia do vencimento é o dia em que o dinheiro saiu; a 1ª parcela vence no mês seguinte.
 *  - PARCELADO: juros simples ao mês sobre o capital. parcela = ceil(capital × (1 + taxa × n) ÷ n); o cliente paga parcela × n.
 *  - JUROS: todo mês o cliente paga só o juro (capital × taxa); o capital vem junto na última parcela.
 */
export function planoEmprestimo(a: EntradaPlano): ItemPlano[] {
  const dia = Number(a.data.slice(8, 10))
  const t = a.taxa / 100
  if (a.modalidade === 'PARCELADO') {
    const parcela = ceilCent((a.capital * (1 + t * a.n)) / a.n)
    return Array.from({ length: a.n }, (_, i) => ({ vencimento: somaMes(a.data, i + 1, dia), valor: parcela }))
  }
  if (a.modalidade === 'JUROS') {
    const juro = arred2(a.capital * t)
    return Array.from({ length: a.n }, (_, i) => ({ vencimento: somaMes(a.data, i + 1, dia), valor: arred2(juro + (i === a.n - 1 ? a.capital : 0)) }))
  }
  throw new Error(`Modalidade ainda não disponível: ${a.modalidade}`)
}

export const totalDoPlano = (p: ItemPlano[]) => arred2(p.reduce((s, x) => s + x.valor, 0))
