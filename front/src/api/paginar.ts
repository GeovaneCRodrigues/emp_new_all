/** Lê todas as páginas de uma lista (o servidor limita a 100 por vez). Para na última página ou em `max` páginas. */
export async function todasAsPaginas<T>(buscar: (pagina: number) => Promise<{ itens: T[]; total: number }>, max = 30): Promise<T[]> {
  const out: T[] = []
  for (let p = 1; p <= max; p++) {
    const r = await buscar(p)
    out.push(...r.itens)
    if (out.length >= r.total || !r.itens.length) break
  }
  return out
}
