import type { Knex } from 'knex'

export type EntradaDatada = { alvo: 'VENDA' | 'EMPRESTIMO'; operacaoId: number; data: string; valor: number }

export interface RelatoriosRepository {
  /** Cada vez que um pagamento de parcela entrou (recibo não desfeito), e o capital que o só juros amortizou. */
  entradas(): Promise<EntradaDatada[]>
  /** Custo (com extras) dos aparelhos disponíveis no estoque. */
  estoque(): Promise<number>
  /** Aportes menos retiradas feitos até hoje. */
  aportes(hoje: string): Promise<number>
  /** Data em que a loja comprou o aparelho de cada venda (venda → data), para contar os dias parado. Aparelho migrado do sistema antigo fica de fora: lá não existia a data de compra. */
  compraDoAparelho(): Promise<Map<number, string>>
}

const dia = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)

export function createRelatoriosRepository(db: Knex): RelatoriosRepository {
  return {
    async entradas() {
      const ls = await db.raw<{ rows: { alvo: 'VENDA' | 'EMPRESTIMO'; op: number; data: Date | string; valor: string }[] }>(`
        select 'VENDA' as alvo, vp.venda_id as op, t.data_recebimento as data, r.valor
          from recebimentos r join transacoes_recebimento t on t.id = r.transacao_id join venda_parcelas vp on vp.id = r.venda_parcela_id
         where t.desfeita_em is null
        union all
        select 'EMPRESTIMO', ep.emprestimo_id, t.data_recebimento, r.valor
          from recebimentos r join transacoes_recebimento t on t.id = r.transacao_id join emprestimo_parcelas ep on ep.id = r.emprestimo_parcela_id
         where t.desfeita_em is null
        union all
        select 'EMPRESTIMO', x.emprestimo_id, t.data_recebimento, (t.ajustes->>'amortizacao')::numeric
          from transacoes_recebimento t
          join (select distinct r.transacao_id, p.emprestimo_id from recebimentos r join emprestimo_parcelas p on p.id = r.emprestimo_parcela_id) x on x.transacao_id = t.id
         where t.desfeita_em is null and t.ajustes is not null and coalesce((t.ajustes->>'amortizacao')::numeric, 0) > 0`)
      return ls.rows.map((l) => ({ alvo: l.alvo, operacaoId: Number(l.op), data: dia(l.data), valor: Number(l.valor) }))
    },
    async estoque() {
      const l = await db('bens').where({ estado: 'DISPONIVEL' }).first<{ total: string | null }>(db.raw('coalesce(sum(valor_compra + custos_extras), 0) as total'))
      return Number(l?.total ?? 0)
    },
    async aportes(hoje) {
      const l = await db('movimentacoes_caixa').whereIn('tipo', ['APORTE', 'RETIRADA']).where('data', '<=', hoje)
        .first<{ total: string | null }>(db.raw("coalesce(sum(case when tipo = 'APORTE' then valor else -valor end), 0) as total"))
      return Number(l?.total ?? 0)
    },
    async compraDoAparelho() {
      const ls = await db('vendas as v').join('bens as b', 'b.id', 'v.bem_id').whereNotNull('b.data_compra').whereNull('b.legacy_id').select<{ id: number; data: Date | string }[]>('v.id', 'b.data_compra as data')
      return new Map(ls.map((l) => [l.id, dia(l.data)]))
    },
  }
}
