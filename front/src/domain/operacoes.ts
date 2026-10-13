/** A aba "Todos" de Operações: vendas de iPhone e empréstimos numa lista só, do mais recente pro mais antigo. */
export type ItemOperacao<V, E> = { tipo: 'venda'; chave: string; data: string; v: V } | { tipo: 'emp'; chave: string; data: string; e: E }

export function misturarOperacoes<V extends { id: number; dataVenda: string }, E extends { id: number; dataEmprestimo: string }>(vendas: V[], emps: E[]): ItemOperacao<V, E>[] {
  const itens: ItemOperacao<V, E>[] = [
    ...vendas.map((v) => ({ tipo: 'venda' as const, chave: `v${v.id}`, data: v.dataVenda, v })),
    ...emps.map((e) => ({ tipo: 'emp' as const, chave: `e${e.id}`, data: e.dataEmprestimo, e })),
  ]
  // data mais nova primeiro; no mesmo dia, o lançado depois (id maior) vem antes; empate total: venda antes de empréstimo
  const id = (i: ItemOperacao<V, E>) => (i.tipo === 'venda' ? i.v.id : i.e.id)
  return itens.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : id(b) - id(a) || (a.tipo === b.tipo ? 0 : a.tipo === 'venda' ? -1 : 1)))
}

/** Soma os dois resumos (iPhones + empréstimos); enquanto um deles não chegou, devolve null. */
export function somarResumos(a: { aReceber: number; capitalNaRua?: number; lucroPorVir?: number } | null, b: { aReceber: number; capitalNaRua?: number; lucroPorVir?: number } | null) {
  if (!a || !b) return null
  return { aReceber: a.aReceber + b.aReceber, capitalNaRua: (a.capitalNaRua ?? 0) + (b.capitalNaRua ?? 0), lucroPorVir: (a.lucroPorVir ?? 0) + (b.lucroPorVir ?? 0) }
}
