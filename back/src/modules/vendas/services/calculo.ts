import { somaMes } from '../../../shared/datas.js'

export type ConfigJuros = { pct: number; maxParcelas: number }

export const arred2 = (v: number) => Math.round(v * 100) / 100
/** Arredonda para cima no centavo, ignorando ruído de ponto flutuante (1200,0000000001 → 1200,00). */
export const ceilCent = (v: number) => Math.ceil(Math.round(v * 1e6) / 1e4) / 100

/**
 * Venda parcelada: juros simples de `pct`% por parcela sobre o que sobra depois da entrada e da troca.
 * A parcela é o total ÷ n, arredondada para cima no centavo; o cliente paga `parcela × n`.
 */
export function planoParc(parcelado: number, n: number, jurosPct: number) {
  if (n <= 0) return { parc: 0, totalParcelas: 0, juros: 0 }
  const totalComJuros = arred2(parcelado * (1 + (jurosPct / 100) * n))
  const parc = ceilCent(totalComJuros / n)
  const totalParcelas = arred2(parc * n)
  return { parc, totalParcelas, juros: arred2(totalParcelas - parcelado) }
}

/** Vencimentos: a 1ª no mês seguinte à venda, no dia escolhido (limitado ao fim do mês); as outras mês a mês. */
export const vencimentos = (dataVenda: string, n: number, dia: number) => Array.from({ length: n }, (_, i) => somaMes(dataVenda, i + 1, dia))

export type EntradaSimulacao = { preco: number; entrada: number; troca: number; n: number; investido: number; pctIndicador: number; jurosPct: number }

/** O que o resumo da venda mostra: juros, total, parte do indicador, lucro e em qual parcela o capital volta. */
export function simular(a: EntradaSimulacao) {
  const parcelado = arred2(Math.max(0, a.preco - a.entrada - a.troca))
  const pl = planoParc(parcelado, a.n, a.jurosPct)
  const total = arred2(a.entrada + a.troca + pl.totalParcelas)
  const lucro = arred2(total - a.investido)
  const parteIndicador = lucro > 0 ? arred2(lucro * a.pctIndicador) : 0
  let acum = a.entrada + a.troca
  let capitalVoltaNaParcela: number | null = acum >= a.investido ? 0 : null
  for (let i = 1; i <= a.n && capitalVoltaNaParcela === null; i++) {
    acum += pl.parc
    if (acum >= a.investido) capitalVoltaNaParcela = i
  }
  return { parcelado, parcela: pl.parc, totalParcelas: pl.totalParcelas, juros: pl.juros, total, lucro, parteIndicador, seuLucro: arred2(lucro - parteIndicador), capitalVoltaNaParcela }
}
