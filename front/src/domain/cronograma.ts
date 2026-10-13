import type { CobrancaApi } from '@/api/recebimentos'
import { diasEntre, somaMes } from './datas'
import type { Iso } from './types'

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** "2026-10" → "outubro 2026" */
export const mesLabel = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
/** "outubro" (só o nome, para "3 parcelas em outubro") */
export const mesNome = (ym: string) => MESES[Number(ym.slice(5, 7)) - 1]
/** Soma `n` meses a um "AAAA-MM". */
export const somaYm = (ym: string, n: number) => somaMes(`${ym}-01`, n, 1).slice(0, 7)
/** Valor curto para a célula do dia: 850 → "850", 1.250 → "1,3k", 12.000 → "12k". */
export const kfmt = (v: number) => (v >= 1000 ? `${(Math.round(v / 100) / 10).toLocaleString('pt-BR')}k` : String(Math.round(v)))

const aberta = (c: CobrancaApi) => c.falta > 0.009

/** Previsto, recebido e em atraso das parcelas do mês. */
export function resumoDoMes(itens: CobrancaApi[], hoje: Iso) {
  const soma = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100
  return {
    previsto: soma(itens.map((c) => c.valor)),
    recebido: soma(itens.map((c) => c.pago)),
    atrasado: soma(itens.filter((c) => aberta(c) && c.vencimento < hoje).map((c) => c.falta)),
  }
}

/** A cor do dia: vermelho (atrasado), laranja (vence hoje ou nos próximos 7 dias), cinza (aberto mais longe), verde (tudo pago). */
export type CorDia = 'bad' | 'warn' | 'dim' | 'ok'

export interface DiaCalendario {
  iso: Iso
  dia: number
  itens: CobrancaApi[]
  /** o que o dia mostra: o que falta nas abertas, ou o que foi pago nas quitadas */
  total: number
  cor: CorDia | null
}

export interface GradeMes {
  /** quantas células vazias antes do dia 1 (0 = domingo) */
  vazios: number
  dias: DiaCalendario[]
}

/** O mês em dias, com as parcelas de cada um. Parcelas de outros meses são ignoradas. */
export function gradeDoMes(ym: string, itens: CobrancaApi[], hoje: Iso): GradeMes {
  const [y, m] = ym.split('-').map(Number)
  const vazios = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const dias: DiaCalendario[] = []
  for (let d = 1; d <= ultimo; d++) {
    const iso = `${ym}-${String(d).padStart(2, '0')}`
    const xs = itens.filter((c) => c.vencimento === iso)
    const abertas = xs.filter(aberta)
    const total = Math.round(xs.reduce((s, c) => s + (aberta(c) ? c.falta : c.pago), 0) * 100) / 100
    let cor: CorDia | null = null
    if (xs.length) cor = abertas.length ? (iso < hoje ? 'bad' : iso === hoje || diasEntre(hoje, iso) <= 7 ? 'warn' : 'dim') : 'ok'
    dias.push({ iso, dia: d, itens: xs, total, cor })
  }
  return { vazios, dias }
}
