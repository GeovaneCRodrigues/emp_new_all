/** "agora", "há 5 min", "há 3 h", "ontem" ou o dia (12/11). `agora` e `iso` são instantes (ISO com fuso). */
export function tempoRelativo(iso: string, agora: Date = new Date()): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const min = Math.floor((agora.getTime() - t) / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  if (h < 48) return 'ontem'
  const d = new Date(t)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}
