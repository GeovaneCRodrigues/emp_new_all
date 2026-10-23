import { arred2 } from './format'
import { perdaNoCenario, type Perdas } from './previsao'
import type { Relatorios } from './relatorios'

/** O que o servidor manda: o lucro do dono por mês (já pago e já descontada a parte do indicador) e o que ainda entra se todos pagarem. */
export type DadosReinvestir = Relatorios['reinvestir']

export const RETIRADA_PADRAO = 0.1

/** Lê a % de retirada salva: fora de 0 a 1 (ou lixo) volta ao padrão. */
export function lerRetirada(bruto: unknown): number {
  return typeof bruto === 'number' && Number.isFinite(bruto) && bruto >= 0 && bruto <= 1 ? bruto : RETIRADA_PADRAO
}

export type LinhaLucro = { mes: string; lucro: number; retirada: number; reinvestir: number; acumulado: number }

/** Divide o lucro de cada mês: `retirada` fica com você, o resto reinveste. O acumulado soma o reinvestir. */
function dividir(itens: { mes: string; lucro: number }[], retirada: number, acumuladoInicial: number): LinhaLucro[] {
  let acum = acumuladoInicial
  return itens.map(({ mes, lucro }) => {
    const parte = arred2(lucro * retirada)
    const reinvestir = arred2(lucro - parte)
    acum = arred2(acum + reinvestir)
    return { mes, lucro, retirada: parte, reinvestir, acumulado: acum }
  })
}

export type ResultadoReinvestir = {
  realizado: LinhaLucro[]
  previsto: LinhaLucro[]
  totalRealizado: { lucro: number; retirada: number; reinvestir: number }
  totalPrevisto: { lucro: number; retirada: number; reinvestir: number }
  /** lucro esperado depois do último mês mostrado (já com a perda), fora da tabela */
  depois: number
}

const soma = (ls: LinhaLucro[]) => ({ lucro: arred2(ls.reduce((s, l) => s + l.lucro, 0)), retirada: arred2(ls.reduce((s, l) => s + l.retirada, 0)), reinvestir: arred2(ls.reduce((s, l) => s + l.reinvestir, 0)) })

/**
 * Os últimos meses (o que já entrou) e os próximos (o que se espera). A perda esperada de cada grupo tira a mesma fatia do lucro daquele grupo:
 * é uma estimativa, e na prática um calote tira mais lucro que isso (o capital volta primeiro).
 * O atraso entra no mês atual, cada faixa com a sua perda.
 */
export function projetarReinvestir(d: DadosReinvestir, perdas: Perdas, fator: number, retirada: number): ResultadoReinvestir {
  const manter = (p: number) => 1 - perdaNoCenario(p, fator)
  const atraso = arred2(d.previsto.atraso.ate7 * manter(perdas.ate7) + d.previsto.atraso.de8a30 * manter(perdas.de8a30) + d.previsto.atraso.mais30 * manter(perdas.mais30))
  const realizado = dividir(d.meses.map((mes, i) => ({ mes, lucro: d.lucroPorMes[i] })), retirada, 0)
  const previsto = dividir(d.previsto.porMes.map((m, i) => ({ mes: m.mes, lucro: arred2(m.lucro * manter(perdas.aVencer) + (i === 0 ? atraso : 0)) })), retirada, 0)
  return { realizado, previsto, totalRealizado: soma(realizado), totalPrevisto: soma(previsto), depois: arred2(d.previsto.depois * manter(perdas.aVencer)) }
}
