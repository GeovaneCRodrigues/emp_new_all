import type { Iso } from './types'

const brl = (v: number, casas: number) =>
  Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })

export const fmt = (v: number) => (v < 0 ? '−' : '') + 'R$ ' + brl(v, 2)
export const fmt0 = (v: number) => (v < 0 ? '−' : '') + 'R$ ' + brl(Math.round(v), 0)

/** "4.000,50" ou número → número. Texto vazio vira 0. */
export const numBR = (v: unknown): number =>
  typeof v === 'number' ? v : Number(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0

export const moneyBR = (v: unknown) => brl(numBR(v), 2)

/** Máscara que digita pelos centavos: "400000" → "4.000,00". */
export function mascaraCentavos(texto: string): { texto: string; valor: number } {
  const dig = texto.replace(/\D/g, '').replace(/^0+/, '').slice(0, 12)
  const valor = Number(dig || 0) / 100
  return { texto: moneyBR(valor), valor }
}

export const dmy = (iso: Iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7)
export const dmyA = (iso: Iso) => `${dmy(iso)}/${iso.slice(0, 4)}`

/** As iniciais da bolinha do cliente: a 1ª letra das duas primeiras palavras. O apelido entre parênteses ("WEVERTON (DEDA)") não conta, e símbolos nunca viram inicial. */
export const iniciais = (nome: string) => {
  const letras = (t: string) => t.split(/\s+/).map((p) => p.match(/\p{L}/u)?.[0]).filter((l): l is string => !!l)
  const semApelido = letras(nome.replace(/\([^)]*\)?/g, ' '))
  return (semApelido.length ? semApelido : letras(nome)).slice(0, 2).join('').toLocaleUpperCase('pt-BR')
}

/** Cadastro padronizado: sem espaços sobrando e em LETRAS MAIÚSCULAS (nomes e endereços). */
export const maiusculas = (v: string): string => v.trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR')

/** Capacidade do aparelho para mostrar; 0 = não informada (aparelhos migrados do sistema antigo), então some. */
export const gbTxt = (gb: number): string => (gb > 0 ? `${gb} GB` : '')

export const arred2 = (v: number) => Math.round(v * 100) / 100 + 0 // "+ 0" troca -0 por 0

/** Arredonda para cima no centavo, ignorando ruído de ponto flutuante (1200,0000000001 → 1200,00). */
export const ceilCent = (v: number) => Math.ceil(Math.round(v * 1e6) / 1e4) / 100
