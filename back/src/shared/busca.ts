import type { Knex } from 'knex'

const MAX = 80

/** O texto da busca como o banco compara: sem acento, minúsculo, espaços simples. Vazio ou não-texto = sem busca. */
export function termoBusca(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, MAX)
  return t || undefined
}

const escaparLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c)

/** Os campos de texto juntos, sem acento e em minúsculo (uma só string para cada linha). */
const palheiro = (colunas: string[]) =>
  `translate(lower(concat_ws(' ', ${colunas.map((c) => `coalesce(${c}::text, '')`).join(', ')})), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')`

/**
 * Cada palavra digitada tem de aparecer em algum dos campos (em qualquer ordem): "joao silva" acha "João da Silva".
 * `colunas` são nomes de coluna fixos do código, nunca texto do usuário.
 */
export function filtrarPorTexto<T extends Knex.QueryBuilder>(q: T, colunas: string[], busca: string | undefined): T {
  if (!busca) return q
  const expr = palheiro(colunas)
  for (const palavra of busca.split(' ')) q.whereRaw(`${expr} like ? escape '\\'`, [`%${escaparLike(palavra)}%`])
  return q
}
