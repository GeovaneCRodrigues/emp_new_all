export const soDigitos = (v: string) => v.replace(/\D/g, '')

/** CPF com os dois dígitos verificadores certos. Aceita com ou sem pontuação. Sequências iguais não valem. */
export function cpfValido(valor: string): boolean {
  const c = soDigitos(valor)
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false
  for (const t of [9, 10]) {
    let soma = 0
    for (let i = 0; i < t; i++) soma += Number(c[i]) * (t + 1 - i)
    if (((soma * 10) % 11) % 10 !== Number(c[t])) return false
  }
  return true
}

/** Telefone brasileiro só com dígitos (DDD + número). Aceita +55. Devolve null se não parece telefone. */
export function normalizarFone(valor: string): string | null {
  let d = soDigitos(valor)
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  if (d.length !== 10 && d.length !== 11) return null
  if (/^0/.test(d) || (d.length === 11 && d[2] !== '9')) return null
  return d
}

/** Máscara que vai se formando enquanto digita: 52998224725 → 529.982.247-25 */
export function mascaraCpf(v: string): string {
  const d = soDigitos(v).slice(0, 11)
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2')
}

/** (11) 98812-4410 ou (11) 3322-1100, formando enquanto digita. */
export function mascaraFone(v: string): string {
  let d = soDigitos(v)
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  d = d.slice(0, 11)
  if (d.length <= 2) return d ? `(${d}` : ''
  const cauda = d.length > 10 ? d.slice(2, 7) + '-' + d.slice(7) : d.slice(2, 6) + (d.length > 6 ? '-' + d.slice(6) : '')
  return `(${d.slice(0, 2)}) ${cauda}`
}
