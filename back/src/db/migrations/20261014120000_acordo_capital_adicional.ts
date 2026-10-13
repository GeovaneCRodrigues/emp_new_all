import type { Knex } from 'knex'

/**
 * Dinheiro novo emprestado dentro de um acordo de empréstimo. O valor soma no capital do empréstimo (lucro, repasse e
 * capital na rua seguem sozinhos) e fica aqui para o Caixa mostrar a saída na data do acordo, e não na do empréstimo.
 */
export async function up(knex: Knex) {
  await knex.schema.alterTable('acordos', (t) => { t.decimal('capital_adicional', 15, 2).notNullable().defaultTo(0) })
  await knex.raw('alter table acordos add constraint acordos_capital_adicional_ck check (capital_adicional >= 0)')
}

export async function down(knex: Knex) {
  await knex.raw('alter table acordos drop constraint if exists acordos_capital_adicional_ck')
  await knex.schema.alterTable('acordos', (t) => { t.dropColumn('capital_adicional') })
}
