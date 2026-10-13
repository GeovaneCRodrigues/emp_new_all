import { describe, expect, it } from 'vitest'
import { carregarCadeia, MAX_PAGINAS, PAGINA_CHEIA, todasAsPaginas } from './paginar'

const pagina = (n: number, total: number) => ({ itens: Array.from({ length: Math.max(0, Math.min(PAGINA_CHEIA, total - (n - 1) * PAGINA_CHEIA)) }, (_, i) => (n - 1) * PAGINA_CHEIA + i), total })

function montar(total: number, o: { falharNaPagina?: number; ativo?: () => boolean } = {}) {
  const chamadas: number[] = []
  const lista: number[] = []
  const { primeira, fim } = carregarCadeia({
    buscar: async (p) => { chamadas.push(p); if (p === o.falharNaPagina) throw new Error('caiu'); return pagina(p, total) },
    aplicar: (r, p) => { lista.splice(p === 1 ? 0 : lista.length, p === 1 ? lista.length : 0, ...r.itens) },
    ativo: o.ativo ?? (() => true), mostrados: () => lista.length,
  })
  return { chamadas, lista, primeira, fim }
}

describe('carregarCadeia: a lista inteira, sem botão', () => {
  it('carrega todas as páginas em ordem e para quando chegou tudo', async () => {
    const m = montar(250)
    await m.fim
    expect(m.chamadas).toEqual([1, 2, 3]); expect(m.lista).toHaveLength(250); expect(m.lista).toEqual(Array.from({ length: 250 }, (_, i) => i))
  })
  it('a primeira página aparece antes do resto (o resto chega em segundo plano)', async () => {
    const m = montar(250)
    await m.primeira
    expect(m.lista.length).toBeGreaterThanOrEqual(PAGINA_CHEIA)
    await m.fim
    expect(m.lista).toHaveLength(250)
  })
  it('lista de uma página só (ou vazia) faz um pedido só', async () => {
    const a = montar(40); await a.fim; expect(a.chamadas).toEqual([1]); expect(a.lista).toHaveLength(40)
    const b = montar(0); await b.fim; expect(b.chamadas).toEqual([1]); expect(b.lista).toHaveLength(0)
    const c = montar(PAGINA_CHEIA); await c.fim; expect(c.chamadas).toEqual([1]) // exatamente uma página cheia: não pede a seguinte
  })
  it('tem trava de segurança: nunca passa de 30 páginas (3.000 itens)', async () => {
    const m = montar(10_000)
    await m.fim
    expect(m.chamadas).toHaveLength(MAX_PAGINAS); expect(m.lista).toHaveLength(MAX_PAGINAS * PAGINA_CHEIA)
  })
  it('se a busca/filtro mudou no meio, para sem aplicar nem pedir mais', async () => {
    let vale = true
    const m = montar(1000, { ativo: () => vale })
    await m.primeira
    vale = false
    await m.fim
    expect(m.lista.length).toBeLessThan(1000); expect(m.chamadas.length).toBeLessThan(10)
    const antes = m.lista.length
    await new Promise((r) => setTimeout(r, 5))
    expect(m.lista.length).toBe(antes) // nada chega depois
  })
  it('carga que já nasce obsoleta não aplica nada, mas libera quem espera a primeira página', async () => {
    const m = montar(500, { ativo: () => false })
    await m.primeira; await m.fim
    expect(m.lista).toHaveLength(0); expect(m.chamadas).toEqual([1])
  })
  it('erro na primeira página rejeita as duas promessas; erro no meio mantém o que já chegou', async () => {
    const a = montar(300, { falharNaPagina: 1 })
    await expect(a.primeira).rejects.toThrow('caiu'); await expect(a.fim).rejects.toThrow('caiu'); expect(a.lista).toHaveLength(0)
    const b = montar(300, { falharNaPagina: 2 })
    await b.primeira; await expect(b.fim).rejects.toThrow('caiu')
    expect(b.lista).toHaveLength(PAGINA_CHEIA)
  })
  it('servidor que devolve página vazia antes do total não prende em laço', async () => {
    const chamadas: number[] = []; const lista: number[] = []
    await carregarCadeia({ buscar: async (p) => { chamadas.push(p); return { itens: p === 1 ? [1, 2, 3] : [], total: 99 } }, aplicar: (r) => lista.push(...(r.itens as number[])), ativo: () => true, mostrados: () => lista.length }).fim
    expect(chamadas).toEqual([1, 2]) // a 2ª veio vazia: para ali, mesmo faltando para o total
  })
})

describe('todasAsPaginas (já existia)', () => {
  it('continua juntando as páginas', async () => { expect((await todasAsPaginas(async (p) => pagina(p, 230))).length).toBe(230) })
})
