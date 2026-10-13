import type { Sessao } from '@/domain/escopo'
import { arred2 } from '@/domain/format'
import { montarRelatorios, type OpRelatorio } from '@/domain/relatorios'
import { ErroApi } from './clientes'
import type { CaixaApi } from './caixa'
import type { EmprestimosFake } from './emprestimos.fake'
import type { EstoqueApi } from './estoque'
import { todasAsPaginas } from './paginar'
import type { RelatoriosApi } from './relatorios'
import type { RepassesApi } from './repasses'
import type { VendasFake } from './vendas.fake'

const ADM: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const diasEntre = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86_400_000))

/**
 * Versão de demonstração: as mesmas regras do backend, sobre as vendas, empréstimos, estoque, caixa e repasses da demonstração.
 * Retomada e cancelada ficam de fora; o dinheiro que entra primeiro devolve o capital e o resto é lucro.
 */
export function criarRelatoriosFake(dep: { vendas: VendasFake; emprestimos: EmprestimosFake; estoque: EstoqueApi; caixa: CaixaApi; repasses: RepassesApi }): RelatoriosApi {
  const hoje = dep.vendas._interno.hoje
  return {
    async ver(s) {
      if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Só o administrador vê os relatórios', 'SEM_PERMISSAO')
      const pagos = dep.vendas._interno.transacoes.filter((t) => !t.desfeita && t.tipo === 'PARCELA')
      const doDia = (alvo: 'VENDA' | 'EMPRESTIMO', id: number) => pagos.filter((t) => t.alvo === alvo && t.operacaoId === id).map((t) => ({ data: t.data, valor: t.valor }))
      const aparelhos = await todasAsPaginas((p) => dep.estoque.listar(ADM, { pagina: p, limite: 100 }))
      const caixa = await dep.caixa.ver(ADM, { limite: 1 })
      const movimentos = await todasAsPaginas((p) => dep.caixa.ver(ADM, { pagina: p, limite: 100 }))
      const repasses = await dep.repasses.resumo(ADM)
      const ops: OpRelatorio[] = []

      for (const r of dep.vendas._interno.registros) {
        const c = dep.vendas._interno.calcular(r, 'ADMIN')
        if (c.status !== 'ATIVA' && c.status !== 'QUITADA') continue
        const ap = aparelhos.find((a) => a.id === r.aparelho.id)
        ops.push({
          tipo: 'VENDA', id: r.id, data: r.dataVenda, status: c.status, indicadorId: r.indicador?.id ?? null, pct: r.pct, investido: r.investido, total: c.total, recebido: c.recebido, falta: c.falta,
          lucroTotal: c.lucroTotal ?? 0, capitalDeVolta: c.capitalDeVolta ?? Math.min(r.investido, c.recebido), jurosRecebidos: null, modelo: r.aparelho.modelo,
          diasParado: ap?.dataCompra ? diasEntre(ap.dataCompra, r.dataVenda) : null,
          parcelas: r.parcelas.map((p) => ({ vencimento: p.vencimento, valor: p.valor, desconto: p.desconto, pago: p.pago })),
          entradas: [...(r.entrada + r.troca > 0 ? [{ data: r.dataVenda, valor: arred2(r.entrada + r.troca) }] : []), ...doDia('VENDA', r.id)],
        })
      }
      for (const r of dep.emprestimos._interno.registros) {
        const c = dep.emprestimos._interno.calcular(r, 'ADMIN')
        if (c.status !== 'ATIVA' && c.status !== 'QUITADA') continue
        ops.push({
          tipo: 'EMPRESTIMO', id: r.id, data: r.dataEmprestimo, status: c.status, indicadorId: r.indicador?.id ?? null, pct: r.pct, investido: r.capital, total: c.total, recebido: c.recebido, falta: c.falta,
          lucroTotal: c.lucroTotal ?? 0, capitalDeVolta: c.capitalDeVolta ?? Math.min(r.capital, c.recebido), jurosRecebidos: null, modelo: null, diasParado: null,
          parcelas: r.parcelas.map((p) => ({ vencimento: p.vencimento, valor: p.valor, desconto: p.desconto, pago: p.pago })),
          entradas: doDia('EMPRESTIMO', r.id),
        })
      }
      const estoque = arred2(aparelhos.filter((a) => a.estado === 'DISPONIVEL').reduce((x, a) => x + (a.custo ?? 0) + (a.extras ?? 0), 0))
      const aportes = arred2(movimentos.reduce((x, m) => x + (m.categoria === 'APORTE' ? m.valor : m.categoria === 'RETIRADA' ? -m.valor : 0), 0))
      return montarRelatorios(ops, {
        hoje, caixa: caixa.saldo, estoque, aportes,
        repassesAPagar: arred2(repasses.reduce((x, i) => x + i.resumo.aPagar, 0)), repassesFuturos: arred2(repasses.reduce((x, i) => x + i.resumo.vaiLiberar, 0)),
        indicadores: repasses.map((i) => ({ id: i.indicador.id, nome: i.indicador.nome })),
      })
    },
  }
}
