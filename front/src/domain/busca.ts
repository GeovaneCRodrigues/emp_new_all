/** O texto sem acento, em minúsculo e com espaços simples (como o servidor compara). */
export function normalizarBusca(t: string | null | undefined): string {
  return (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80)
}

/**
 * Cada palavra digitada tem de aparecer em algum dos campos, em qualquer ordem ("joao silva" acha "João da Silva").
 * Busca vazia acha tudo. É a mesma regra do servidor (shared/busca.ts), usada na demonstração e nas listas que já vêm inteiras.
 */
export function casaBusca(campos: (string | number | null | undefined)[], busca: string | null | undefined): boolean {
  const b = normalizarBusca(busca)
  if (!b) return true
  const texto = normalizarBusca(campos.filter((c) => c !== null && c !== undefined).join(' '))
  return b.split(' ').every((palavra) => texto.includes(palavra))
}
