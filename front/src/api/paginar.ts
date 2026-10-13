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

/** Tamanho de página das listas que carregam tudo sozinhas (o máximo que o servidor aceita por pedido). */
export const PAGINA_CHEIA = 100
/** Trava de segurança: 30 páginas (3.000 itens). Passou disso, a tela avisa para usar a busca. */
export const MAX_PAGINAS = 30

/**
 * Carrega uma lista inteira, página a página, em segundo plano: a primeira página aparece logo (`primeira`) e o resto vai chegando.
 * `ativo` diz se esta carga ainda vale (a busca ou o filtro mudou? então para sem aplicar mais nada).
 * `fim` termina quando chegou tudo, quando bateu a trava de segurança ou quando a carga deixou de valer; rejeita no primeiro erro.
 */
export function carregarCadeia<R extends { itens: unknown[]; total: number }>(o: {
  buscar: (pagina: number) => Promise<R>
  aplicar: (r: R, pagina: number) => void
  ativo: () => boolean
  mostrados: () => number
}): { primeira: Promise<void>; fim: Promise<void> } {
  let liberar!: () => void, falhar!: (e: unknown) => void
  const primeira = new Promise<void>((ok, nao) => { liberar = ok; falhar = nao })
  const fim = (async () => {
    try {
      for (let p = 1; p <= MAX_PAGINAS; p++) {
        const r = await o.buscar(p)
        if (!o.ativo()) { liberar(); return }
        o.aplicar(r, p)
        liberar()
        if (o.mostrados() >= r.total || !r.itens.length) return
      }
    } catch (e) {
      falhar(e); throw e
    }
  })()
  return { primeira, fim }
}
