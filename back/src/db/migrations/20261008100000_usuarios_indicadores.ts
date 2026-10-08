import type { Knex } from 'knex'

export async function up(knex: Knex) {
  // % do indicador é sempre uma fração entre 0 e 1 (0,5000 = 50%), em todas as tabelas
  await knex.schema.createTable('indicadores', (t) => {
    t.increments('id')
    t.string('nome', 160).notNullable()
    t.string('whatsapp', 20)
    t.decimal('pct', 5, 4).notNullable().defaultTo(0.5)
    // true quando o % foi definido à mão: aí não sobe sozinho com o nível
    t.boolean('pct_manual').notNullable().defaultTo(false)
    t.boolean('ativo').notNullable().defaultTo(true)
    t.timestamps(true, true)
  })
  await knex.raw('alter table indicadores add constraint indicadores_pct_ck check (pct >= 0 and pct <= 1)')

  await knex.schema.createTable('users', (t) => {
    t.increments('id')
    t.string('nome', 160).notNullable()
    t.string('email', 255).notNullable()
    t.string('senha_hash', 255).notNullable()
    t.text('perfil').notNullable()
    // só para o perfil INDICADOR: de qual indicador é este acesso
    t.integer('indicador_id').references('id').inTable('indicadores').onDelete('SET NULL')
    t.string('fone', 20)
    t.boolean('ativo').notNullable().defaultTo(true)
    t.timestamps(true, true)
  })
  await knex.raw("alter table users add constraint users_perfil_ck check (perfil in ('ADMIN','VENDEDOR','COBRADOR','INDICADOR'))")
  await knex.raw("alter table users add constraint users_indicador_ck check ((perfil = 'INDICADOR') = (indicador_id is not null))")
  await knex.raw('create unique index users_email_uq on users (lower(email))')
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists('users')
  await knex.schema.dropTableIfExists('indicadores')
}
