import type { Knex } from 'knex'

/** De quanto em quanto tempo vencem as parcelas novas do acordo. Os acordos que já existem eram todos mensais. */
export async function up(knex: Knex) {
  await knex.schema.alterTable('acordos', (t) => { t.string('periodicidade', 10).notNullable().defaultTo('MENSAL') })
  await knex.raw(`alter table acordos add constraint acordos_periodicidade_ck check (periodicidade in ('MENSAL','QUINZENAL','SEMANAL','DIARIA'))`)
}

export async function down(knex: Knex) {
  await knex.raw('alter table acordos drop constraint if exists acordos_periodicidade_ck')
  await knex.schema.alterTable('acordos', (t) => { t.dropColumn('periodicidade') })
}
