import type { Knex } from 'knex'

export async function up(knex: Knex) {
  await knex.schema.alterTable('indicadores', (t) => { t.string('chave_pix', 120) })
  // acesso criado pelo admin nasce com senha temporária: a pessoa é obrigada a trocar antes de usar o sistema
  await knex.schema.alterTable('users', (t) => { t.boolean('senha_temporaria').notNullable().defaultTo(false) })
  // um indicador tem no máximo um acesso
  await knex.raw("create unique index users_indicador_uq on users (indicador_id) where indicador_id is not null")
}

export async function down(knex: Knex) {
  await knex.raw('drop index if exists users_indicador_uq')
  await knex.schema.alterTable('users', (t) => { t.dropColumn('senha_temporaria') })
  await knex.schema.alterTable('indicadores', (t) => { t.dropColumn('chave_pix') })
}
