import { arred2 } from './format'
import type { Relatorios } from './relatorios'

/** A previsão que o servidor manda: o que está em aberto e é devido, sem perda nenhuma aplicada. */
export type Previsao = Relatorios['previsao']

/** Chance de NÃO receber, por grupo (0 a 1). É suposição sua, ajustada na tela. */
export type Perdas = { aVencer: number; ate7: number; de8a30: number; mais30: number }
export const PERDAS_PADRAO: Perdas = { aVencer: 0.05, ate7: 0.1, de8a30: 0.3, mais30: 0.7 }

/** O pessimista dobra as perdas; o otimista corta pela metade. */
export const CENARIOS = [
  { id: 'pessimista', rotulo: 'Pessimista', fator: 2 },
  { id: 'realista', rotulo: 'Realista', fator: 1 },
  { id: 'otimista', rotulo: 'Otimista', fator: 0.5 },
] as const
export type IdCenario = (typeof CENARIOS)[number]['id']

const limitar = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
export const perdaNoCenario = (perda: number, fator: number) => limitar(perda * fator)

/** Lê os percentuais salvos: qualquer coisa fora de 0 a 1 (ou lixo) volta ao padrão daquele campo. */
export function lerPerdas(bruto: unknown): Perdas {
  const o = typeof bruto === 'object' && bruto !== null ? (bruto as Record<string, unknown>) : {}
  const campo = (k: keyof Perdas) => (typeof o[k] === 'number' && Number.isFinite(o[k] as number) && (o[k] as number) >= 0 && (o[k] as number) <= 1 ? (o[k] as number) : PERDAS_PADRAO[k])
  return { aVencer: campo('aVencer'), ate7: campo('ate7'), de8a30: campo('de8a30'), mais30: campo('mais30') }
}

export type ResultadoCenario = {
  /** o que se espera receber do atraso e do a vencer, já sem a perda */
  recuperadoAtraso: number
  recuperadoAVencer: number
  recuperado: number
  /** tudo o que o cliente deve (atraso + a vencer), sem perda */
  devido: number
  perdido: number
  /** a parte dos indicadores cai na mesma proporção: eles só recebem quando o dinheiro entra */
  indicadores: number
  /** caixa + o que se espera receber − a parte dos indicadores − repasses já liberados */
  naMao: number
  porMes: { mes: string; valor: number; esperado: number }[]
}

export function cenario(p: Previsao, perdas: Perdas, fator: number): ResultadoCenario {
  const manter = (perda: number) => 1 - perdaNoCenario(perda, fator)
  const recuperadoAtraso = arred2(p.atraso.ate7.valor * manter(perdas.ate7) + p.atraso.de8a30.valor * manter(perdas.de8a30) + p.atraso.mais30.valor * manter(perdas.mais30))
  const recuperadoAVencer = arred2(p.aVencer.valor * manter(perdas.aVencer))
  const recuperado = arred2(recuperadoAtraso + recuperadoAVencer)
  const devido = arred2(p.atraso.ate7.valor + p.atraso.de8a30.valor + p.atraso.mais30.valor + p.aVencer.valor)
  const indicadores = devido > 0 ? arred2(p.parteIndicadores * (recuperado / devido)) : 0
  return {
    recuperadoAtraso, recuperadoAVencer, recuperado, devido, perdido: arred2(devido - recuperado), indicadores,
    naMao: arred2(p.caixa + recuperado - indicadores - p.repassesAPagar),
    porMes: p.porMes.map((m) => ({ mes: m.mes, valor: m.valor, esperado: arred2(m.valor * manter(perdas.aVencer)) })),
  }
}
