import type { Knex } from 'knex'

/**
 * Unificar empréstimos do mesmo cliente num só (um acordo que junta vários).
 *  - cada empréstimo de origem ganha um acordo (`unificado_em_id` aponta para o novo) e passa o capital que ainda estava na rua
 *    para o novo (`capital_cedido`): o capital dele cai para o que já voltou, e o Caixa continua mostrando o valor original na data original;
 *  - o empréstimo novo ganha um acordo com o `capital_herdado` (não saiu dinheiro do Caixa por ele) e o `capital_adicional` (dinheiro novo).
 */
export async function up(knex: Knex) {
  await knex.schema.alterTable('acordos', (t) => {
    t.integer('unificado_em_id').references('id').inTable('emprestimos').onDelete('SET NULL')
    t.decimal('capital_cedido', 15, 2).notNullable().defaultTo(0)
    t.decimal('capital_herdado', 15, 2).notNullable().defaultTo(0)
  })
  await knex.raw('alter table acordos add constraint acordos_capital_cedido_ck check (capital_cedido >= 0 and capital_herdado >= 0)')
  await knex.raw('create index acordos_unificado_em_idx on acordos (unificado_em_id)')
}

export async function down(knex: Knex) {
  await knex.raw('drop index if exists acordos_unificado_em_idx')
  await knex.raw('alter table acordos drop constraint if exists acordos_capital_cedido_ck')
  await knex.schema.alterTable('acordos', (t) => { t.dropColumn('unificado_em_id'); t.dropColumn('capital_cedido'); t.dropColumn('capital_herdado') })
}
