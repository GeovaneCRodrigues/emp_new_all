import type { Knex } from 'knex'

export async function up(knex: Knex) {
  // Uma linha por login. O refresh token nunca é guardado: só o hash dele.
  await knex.schema.createTable('sessoes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    t.integer('usuario_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.string('refresh_hash', 64).notNullable()
    // hash do token anterior à última renovação: se alguém apresentar ele, o token foi roubado/reusado
    t.string('refresh_hash_anterior', 64)
    t.timestamp('expira_em').notNullable()
    t.timestamp('revogada_em')
    t.string('ip', 64)
    t.string('user_agent', 300)
    t.timestamp('criada_em').notNullable().defaultTo(knex.fn.now())
    t.timestamp('ultimo_uso_em').notNullable().defaultTo(knex.fn.now())
    t.index(['usuario_id'])
  })

  // trava de força bruta por conta
  await knex.schema.alterTable('users', (t) => {
    t.integer('falhas_login').notNullable().defaultTo(0)
    t.timestamp('bloqueado_ate')
    t.timestamp('senha_alterada_em')
  })
}

export async function down(knex: Knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('falhas_login')
    t.dropColumn('bloqueado_ate')
    t.dropColumn('senha_alterada_em')
  })
  await knex.schema.dropTableIfExists('sessoes')
}
