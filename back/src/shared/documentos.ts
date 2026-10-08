/** Só os dígitos de um texto. */
export const soDigitos = (v: string) => v.replace(/\D/g, '')

/** CPF com os dois dígitos verificadores certos. Aceita com ou sem pontuação. Sequências iguais (111.111.111-11) não valem. */
export function cpfValido(valor: string): boolean {
  const c = soDigitos(valor)
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false
  for (const t of [9, 10]) {
    let soma = 0
    for (let i = 0; i < t; i++) soma += Number(c[i]) * (t + 1 - i)
    const dv = ((soma * 10) % 11) % 10
    if (dv !== Number(c[t])) return false
  }
  return true
}

/**
 * Telefone brasileiro só com dígitos (DDD + número, 10 ou 11 dígitos). Aceita +55 na frente.
 * Devolve null se não parece um telefone brasileiro.
 */
export function normalizarFone(valor: string): string | null {
  let d = soDigitos(valor)
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  if (d.length !== 10 && d.length !== 11) return null
  if (/^0/.test(d) || (d.length === 11 && d[2] !== '9')) return null // DDD não começa com 0; celular de 11 dígitos começa com 9
  return d
}
