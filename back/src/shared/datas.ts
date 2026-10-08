/** Soma dias a uma data (AAAA-MM-DD). */
export function addDia(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Soma meses a uma data e fixa o dia (limitado ao último dia do mês). */
export function somaMes(iso: string, n: number, dia: number): string {
  const [y, m] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`
}
