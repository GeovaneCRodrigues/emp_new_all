import { arred2, ceilCent } from './format'
import { addDia, pulaDomingo, somaDiasUteis, somaMes } from './datas'
import type { Bem, ConfigJuros, Emprestimo, Iso, ModalidadeEmp, Operacao, Parcela, Periodicidade, StatusOp, Venda } from './types'

export const JUROS_PADRAO: ConfigJuros = { pct: 10, maxParcelas: 10 }

export const pagoP = (p: Parcela) => p.pagos.reduce((s, x) => s + x.valor, 0)
export const faltaP = (p: Parcela) => arred2(p.valor - pagoP(p) - p.desconto)
export const investido = (b: Bem) => b.custo + b.extras

/** Venda parcelada: juros simples de `pct`% por parcela sobre o que sobra depois da entrada e da troca. */
export function planoParc(parcelado: number, n: number, juros: ConfigJuros = JUROS_PADRAO) {
  if (n <= 0) return { total: 0, parc: 0, juros: 0 }
  const parc = ceilCent(arred2(parcelado * (1 + (juros.pct / 100) * n)) / n)
  // o cliente paga parcela × n (a parcela é arredondada para cima no centavo): é o mesmo número que o backend grava
  const total = arred2(parc * n)
  return { total, parc, juros: arred2(total - parcelado) }
}

/** Resumo financeiro de uma operação. `inv` é o capital investido nela. */
export interface Contas {
  total: number
  recebido: number
  inv: number
  lucroTotal: number
  capitalDeVolta: number
  /** lucro já no bolso: só o que passou do capital, descontada a parte do indicador */
  lucroRealizado: number
  /** lucro previsto do dono depois de tirar a parte do indicador */
  seuLucro: number
  atrasadas: Parcela[]
  falta: number
  status: StatusOp
}

function resumo(args: {
  parcelas: Parcela[]
  jaRecebidoFora: number
  total: number
  inv: number
  pct: number
  status: StatusOp
  hoje: Iso
}): Contas {
  const { parcelas, jaRecebidoFora, total, inv, pct, hoje } = args
  const recebido = jaRecebidoFora + parcelas.reduce((s, x) => s + pagoP(x), 0)
  const descontos = parcelas.reduce((s, x) => s + x.desconto, 0)
  const lucroTotal = total - inv
  const falta = total - recebido - descontos
  return {
    total,
    recebido,
    inv,
    lucroTotal,
    // o dinheiro que entra primeiro devolve o capital; só o que passa disso é lucro
    capitalDeVolta: Math.min(inv, recebido),
    lucroRealizado: Math.max(0, recebido - inv) * (1 - pct),
    seuLucro: lucroTotal > 0 ? lucroTotal * (1 - pct) : lucroTotal,
    atrasadas: parcelas.filter((x) => !x.pago && x.venc < hoje),
    falta,
    status: args.status === 'RETOMADA' ? 'RETOMADA' : falta <= 0.009 ? 'QUITADA' : 'ATIVA',
  }
}

export function contasVenda(v: Venda, b: Bem, hoje: Iso): Contas {
  const totalParc = v.parcelas.reduce((s, x) => s + x.valor, 0)
  return resumo({
    parcelas: v.parcelas,
    jaRecebidoFora: v.entrada + v.troca,
    total: v.entrada + v.troca + totalParc,
    inv: investido(b),
    pct: v.pct,
    status: v.status,
    hoje,
  })
}

export function contasEmp(e: Emprestimo, hoje: Iso): Contas {
  return resumo({
    parcelas: e.parcelas,
    jaRecebidoFora: 0,
    total: e.parcelas.reduce((s, x) => s + x.valor, 0),
    inv: e.capital,
    pct: e.pct,
    status: e.status,
    hoje,
  })
}

export const contasOp = (o: Operacao, bens: Map<number, Bem>, hoje: Iso): Contas =>
  o.tipo === 'EMP' ? contasEmp(o, hoje) : contasVenda(o, bens.get(o.bemId)!, hoje)

/** 1º vencimento padrão: um período depois da data do empréstimo (no mensal, o mesmo dia do mês seguinte). */
export function primeiroVenc(data: Iso, freq: Periodicidade): Iso {
  if (freq === 'QUINZENAL') return addDia(data, 15)
  if (freq === 'SEMANAL') return addDia(data, 7)
  if (freq === 'DIARIA') return somaDiasUteis(data, 1)
  return somaMes(data, 1, Number(data.slice(8, 10)))
}

/**
 * Datas das parcelas. Mensal: o mesmo dia do mês do 1º vencimento (limitado ao fim do mês); quinzenal: de 15 em 15
 * dias; semanal: de 7 em 7; diária: todo dia menos domingo (se o 1º cair no domingo, vai para a segunda).
 */
export function vencimentosEmp(primeira: Iso, freq: Periodicidade, n: number, diaMensal = Number(primeira.slice(8, 10))): Iso[] {
  if (freq === 'DIARIA') {
    const p0 = pulaDomingo(primeira)
    return Array.from({ length: n }, (_, i) => (i ? somaDiasUteis(p0, i) : p0))
  }
  const passo = freq === 'QUINZENAL' ? 15 : freq === 'SEMANAL' ? 7 : 0
  return Array.from({ length: n }, (_, i) => (passo ? addDia(primeira, passo * i) : somaMes(primeira, i, diaMensal)))
}

/**
 * Plano de parcelas de um empréstimo (mesma regra do backend).
 *  - Parcelado e diária: o juro é % NO TOTAL (100% = o cliente paga o dobro), dividido nas parcelas.
 *    parcela = ceil(capital × (1 + taxa%) ÷ n). Ex.: 3.000 a 30% em 6x → 6 × 650,00.
 *  - Só juros: a cada parcela paga só o juro (capital × taxa%) e o capital vem junto na última.
 * Sem `primeira`, o 1º vencimento é um período depois de `data` e o dia do mês é o da própria data.
 */
export function planoEmprestimo(a: { capital: number; mod: ModalidadeEmp; taxa: number; n: number; data: Iso; freq?: Periodicidade; primeira?: Iso }) {
  const c = a.capital || 0
  const t = (a.taxa || 0) / 100
  const freq: Periodicidade = a.mod === 'DIARIA' ? 'DIARIA' : a.freq ?? 'MENSAL'
  const venc = a.primeira ? vencimentosEmp(a.primeira, freq, a.n) : vencimentosEmp(primeiroVenc(a.data, freq), freq, a.n, Number(a.data.slice(8, 10)))
  if (a.mod === 'JUROS') return venc.map((v, i) => ({ venc: v, valor: arred2(c * t) + (i === a.n - 1 ? c : 0) }))
  const parc = ceilCent((c * (1 + t)) / a.n)
  return venc.map((v) => ({ venc: v, valor: parc }))
}

/** Simulação da venda (aba Pagamento): juros, total, parte do indicador, lucro e em qual parcela o capital volta. */
export function simularVenda(a: {
  preco: number
  entrada: number
  troca: number
  n: number
  investido: number
  pctIndicador: number
  juros?: ConfigJuros
}) {
  const parcelado = Math.max(0, a.preco - a.entrada - a.troca)
  const pl = planoParc(parcelado, a.n, a.juros)
  const total = a.entrada + a.troca + pl.total
  const lucro = total - a.investido
  const parteIndicador = lucro > 0 ? lucro * a.pctIndicador : 0
  let acum = a.entrada + a.troca
  let volta: number | null = acum >= a.investido ? 0 : null
  for (let i = 1; i <= a.n && volta === null; i++) {
    acum += pl.parc
    if (acum >= a.investido) volta = i
  }
  return { parcelado, parc: pl.parc, jurosTotal: pl.juros, total, lucro, parteIndicador, seuLucro: lucro - parteIndicador, volta, margem: total ? lucro / total : 0 }
}
