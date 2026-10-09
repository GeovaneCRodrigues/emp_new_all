import type { Knex } from 'knex'

/**
 * Retomada do aparelho: a venda vira RETOMADA e o aparelho volta ao estoque.
 *  - a venda retomada deixa de "ocupar" o aparelho (antes só a cancelada liberava), senão ele não poderia ser vendido de novo;
 *  - guarda quando, quem e por quê;
 *  - um pedido de retomada pendente por venda.
 */
export async function up(knex: Knex) {
  await knex.raw('drop index if exists vendas_bem_ativa_uq')
  await knex.raw("create unique index vendas_bem_ativa_uq on vendas (bem_id) where status not in ('CANCELADA','RETOMADA')")
  await knex.schema.alterTable('vendas', (t) => {
    t.timestamp('retomada_em')
    t.integer('retomada_por').references('id').inTable('users').onDelete('SET NULL')
    t.text('retomada_motivo')
  })
  await knex.raw("create unique index aprovacoes_pendente_retomada_uq on aprovacoes (venda_id) where status = 'PENDENTE' and tipo = 'RETOMADA'")
}

export async function down(knex: Knex) {
  await knex.raw('drop index if exists aprovacoes_pendente_retomada_uq')
  await knex.schema.alterTable('vendas', (t) => { t.dropColumn('retomada_em'); t.dropColumn('retomada_por'); t.dropColumn('retomada_motivo') })
  await knex.raw('drop index if exists vendas_bem_ativa_uq')
  await knex.raw("create unique index vendas_bem_ativa_uq on vendas (bem_id) where status <> 'CANCELADA'")
}
