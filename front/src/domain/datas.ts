import type { Iso } from './types'

export const diasEntre = (a: Iso, b: Iso) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)

export function addDia(iso: Iso, n: number): Iso {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Soma meses a uma data e fixa o dia (limitado ao último dia do mês). */
export function somaMes(iso: Iso, n: number, dia: number): Iso {
  const [y, m] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  const ult = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(dia, ult)).padStart(2, '0')}`
}

/** Soma dias corridos pulando domingo (empréstimo diário). */
export function somaDiasUteis(iso: Iso, n: number): Iso {
  const d = new Date(iso + 'T12:00:00Z')
  let k = 0
  while (k < n) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (d.getUTCDay() !== 0) k++
  }
  return d.toISOString().slice(0, 10)
}

/** Se cair num domingo, vai para a segunda. */
export const pulaDomingo = (iso: Iso): Iso => (new Date(iso + 'T12:00:00Z').getUTCDay() === 0 ? addDia(iso, 1) : iso)
