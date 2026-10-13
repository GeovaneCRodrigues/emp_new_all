import { describe, expect, it } from 'vitest'
import { misturarOperacoes, somarResumos } from './operacoes'

describe('misturarOperacoes', () => {
  it('põe vendas e empréstimos juntos, do mais novo pro mais antigo', () => {
    const r = misturarOperacoes(
      [{ id: 1, dataVenda: '2026-10-01' }, { id: 2, dataVenda: '2026-10-05' }],
      [{ id: 7, dataEmprestimo: '2026-10-03' }, { id: 8, dataEmprestimo: '2026-10-09' }],
    )
    expect(r.map((i) => i.chave)).toEqual(['e8', 'v2', 'e7', 'v1'])
  })
  it('no mesmo dia, o id maior vem antes; empate total, a venda vem antes', () => {
    const r = misturarOperacoes([{ id: 3, dataVenda: '2026-10-05' }, { id: 5, dataVenda: '2026-10-05' }], [{ id: 5, dataEmprestimo: '2026-10-05' }, { id: 9, dataEmprestimo: '2026-10-05' }])
    expect(r.map((i) => i.chave)).toEqual(['e9', 'v5', 'e5', 'v3'])
  })
  it('listas vazias', () => { expect(misturarOperacoes([], [])).toEqual([]) })
  it('não mexe nas listas de entrada', () => {
    const v = [{ id: 1, dataVenda: '2026-10-01' }, { id: 2, dataVenda: '2026-10-05' }]
    misturarOperacoes(v, [])
    expect(v.map((x) => x.id)).toEqual([1, 2])
  })
})

describe('somarResumos', () => {
  it('soma os dois', () => { expect(somarResumos({ aReceber: 100, capitalNaRua: 50, lucroPorVir: 10 }, { aReceber: 20, capitalNaRua: 5, lucroPorVir: 1 })).toEqual({ aReceber: 120, capitalNaRua: 55, lucroPorVir: 11 }) })
  it('campo ausente conta como zero', () => { expect(somarResumos({ aReceber: 1 }, { aReceber: 2, capitalNaRua: 3 })).toEqual({ aReceber: 3, capitalNaRua: 3, lucroPorVir: 0 }) })
  it('devolve null se faltar um dos dois', () => { expect(somarResumos(null, { aReceber: 1 })).toBeNull() })
})
