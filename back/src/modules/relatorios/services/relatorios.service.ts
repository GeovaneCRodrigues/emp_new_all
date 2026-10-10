import { semPermissao } from '../../../shared/errors.js'
import type { Sessao } from '../../../shared/perfis.js'
import { hojeBR } from '../../../shared/relogio.js'
import type { CaixaRepository } from '../../caixa/models/repository.js'
import type { EmprestimosRepository } from '../../emprestimos/models/repository.js'
import { jurosRecebidosSoJuros } from '../../emprestimos/services/calculo.js'
import type { IndicadoresRepository } from '../../indicadores/models/repository.js'
import type { RepassesService } from '../../repasses/services/repasses.service.js'
import type { VendasRepository } from '../../vendas/models/repository.js'
import { arred2 } from '../../vendas/services/calculo.js'
import { contas } from '../../vendas/services/contas.js'
import type { RelatoriosRepository } from '../models/repository.js'
import { montarRelatorios, type OpRelatorio, type Relatorios } from './calculo.js'

export type RelatoriosService = { ver(s: Sessao): Promise<Relatorios> }

type Dependencias = {
  repo: RelatoriosRepository
  vendas: VendasRepository
  emprestimos: EmprestimosRepository
  caixa: CaixaRepository
  indicadores: IndicadoresRepository
  repasses: RepassesService
  hoje?: () => string
}

const diasEntre = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86_400_000))

export function createRelatoriosService(d: Dependencias): RelatoriosService {
  const hoje = d.hoje ?? (() => hojeBR())
  const tudo = { tipo: 'TODOS' } as const

  return {
    async ver(s) {
      if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador vê os relatórios')
      const dia = hoje()
      const [vendas, emprestimos, entradas, estoque, aportes, compras, indicadores, repasses, caixa] = await Promise.all([
        d.vendas.listar(tudo), d.emprestimos.listar(tudo), d.repo.entradas(), d.repo.estoque(), d.repo.aportes(dia), d.repo.compraDoAparelho(),
        d.indicadores.listar(), d.repasses.resumo(s), d.caixa.resumo({ hoje: dia, mesIni: `${dia.slice(0, 7)}-01`, mesFim: dia }),
      ])
      const doDia = (alvo: 'VENDA' | 'EMPRESTIMO', id: number) => entradas.filter((e) => e.alvo === alvo && e.operacaoId === id).map((e) => ({ data: e.data, valor: e.valor }))
      const parcelas = (ps: { vencimento: string; valor: number; desconto: number; pago: number }[]) => ps.map((p) => ({ vencimento: p.vencimento, valor: p.valor, desconto: p.desconto, pago: p.pago }))

      const ops: OpRelatorio[] = []
      for (const v of vendas) {
        const c = contas({ entrada: v.entrada, troca: v.troca, investido: v.investido, pct: v.pct, statusGravado: v.status, parcelas: parcelas(v.parcelas) }, dia)
        if (c.status !== 'ATIVA' && c.status !== 'QUITADA') continue
        const compra = compras.get(v.id)
        ops.push({
          tipo: 'VENDA', id: v.id, data: v.dataVenda, status: c.status, indicadorId: v.indicador?.id ?? null, pct: v.pct, investido: v.investido, total: c.total, recebido: c.recebido, falta: c.falta,
          lucroTotal: c.lucroTotal, capitalDeVolta: c.capitalDeVolta, jurosRecebidos: null,
          modelo: v.aparelho.modelo, diasParado: compra ? diasEntre(compra, v.dataVenda) : null, parcelas: parcelas(v.parcelas),
          // a entrada e a troca valem na data da venda; o resto, na data de cada recebimento
          entradas: [...(v.entrada + v.troca > 0 ? [{ data: v.dataVenda, valor: arred2(v.entrada + v.troca) }] : []), ...doDia('VENDA', v.id)],
        })
      }
      for (const e of emprestimos) {
        const c = contas({ entrada: e.amortizado, troca: 0, investido: e.capital, pct: e.pct, statusGravado: e.status, parcelas: parcelas(e.parcelas) }, dia)
        if (c.status !== 'ATIVA' && c.status !== 'QUITADA') continue
        ops.push({
          tipo: 'EMPRESTIMO', id: e.id, data: e.dataEmprestimo, status: c.status, indicadorId: e.indicador?.id ?? null, pct: e.pct, investido: e.capital, total: c.total, recebido: c.recebido, falta: c.falta,
          lucroTotal: c.lucroTotal, capitalDeVolta: c.capitalDeVolta, jurosRecebidos: jurosRecebidosSoJuros(e),
          modelo: null, diasParado: null, parcelas: parcelas(e.parcelas), entradas: doDia('EMPRESTIMO', e.id),
        })
      }

      return montarRelatorios(ops, {
        hoje: dia, caixa: caixa.saldo, estoque, aportes,
        repassesAPagar: arred2(repasses.reduce((x, r) => x + r.resumo.aPagar, 0)),
        repassesFuturos: arred2(repasses.reduce((x, r) => x + r.resumo.vaiLiberar, 0)),
        indicadores: indicadores.map((i) => ({ id: i.id, nome: i.nome })),
      })
    },
  }
}
