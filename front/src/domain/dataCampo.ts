import type { Iso } from './types'

/** Digita só os números (`08112026`) e a máscara vira `08/11/2026` no caminho. */
export function mascaraData(texto: string): string {
  const d = texto.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
}

/** `08/11/2026` → `2026-11-08`; devolve null se estiver incompleta ou não existir (31/02). */
export function brParaIso(texto: string): Iso | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto)
  if (!m) return null
  const [, d, mes, a] = m
  const iso = `${a}-${mes}-${d}`
  const ok = new Date(iso + 'T12:00:00Z')
  return !Number.isNaN(ok.getTime()) && ok.toISOString().slice(0, 10) === iso ? iso : null
}

export const isoParaBr = (iso: Iso): string => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')

export interface CelulaDia { iso: Iso; dia: number }

/** O calendário de um mês: linhas de 7 dias começando no domingo; `null` completa o começo e o fim. */
export function gradeDoMes(ano: number, mes: number): (CelulaDia | null)[] {
  const primeiro = new Date(Date.UTC(ano, mes - 1, 1, 12))
  const ultimo = new Date(Date.UTC(ano, mes, 0, 12)).getUTCDate()
  const celulas: (CelulaDia | null)[] = Array.from({ length: primeiro.getUTCDay() }, () => null)
  for (let d = 1; d <= ultimo; d++) celulas.push({ iso: `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`, dia: d })
  while (celulas.length % 7) celulas.push(null)
  return celulas
}

/** Dia fora do permitido (antes do mínimo ou depois do máximo) fica apagado. */
export const foraDoLimite = (iso: Iso, min?: Iso, max?: Iso) => (!!min && iso < min) || (!!max && iso > max)

/** Mês anterior/seguinte, trocando o ano na virada. */
export function mudarMes(ano: number, mes: number, delta: number): { ano: number; mes: number } {
  const t = ano * 12 + (mes - 1) + delta
  return { ano: Math.floor(t / 12), mes: (t % 12) + 1 }
}
