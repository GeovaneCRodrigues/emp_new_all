import type { Knex } from 'knex'

export async function up(knex: Knex) {
  // O repasse é pago por indicador (não por operação). Quanto falta em cada operação é calculado,
  // abatendo da mais antiga para a mais nova.
  await knex.schema.createTable('repasses_indicador', (t) => {
    t.increments('id')
    t.integer('indicador_id').notNullable().references('id').inTable('indicadores')
    t.decimal('valor', 15, 2).notNullable()
    t.date('data_repasse').notNullable()
    t.text('forma_pagamento').notNullable()
    t.text('obs')
    t.integer('usuario_id').references('id').inTable('users').onDelete('SET NULL')
    t.timestamps(true, true)
    t.index(['indicador_id'])
  })
  await knex.raw("alter table repasses_indicador add constraint repasses_valor_ck check (valor > 0)")
  await knex.raw("alter table repasses_indicador add constraint repasses_forma_ck check (forma_pagamento in ('PIX','DINHEIRO','TRANSFERENCIA'))")

  await knex.schema.createTable('niveis_indicador', (t) => {
    t.string('id', 20).primary()
    t.string('nome', 40).notNullable()
    t.integer('min_operacoes').notNullable().unique()
    t.decimal('pct', 5, 4).notNullable()
  })
  // números ainda não confirmados pelo Geovane: ficam editáveis
  await knex('niveis_indicador').insert([
    { id: 'BRONZE', nome: 'Bronze', min_operacoes: 0, pct: 0.3 },
    { id: 'PRATA', nome: 'Prata', min_operacoes: 3, pct: 0.4 },
    { id: 'OURO', nome: 'Ouro', min_operacoes: 5, pct: 0.5 },
    { id: 'DIAMANTE', nome: 'Diamante', min_operacoes: 10, pct: 0.55 },
  ])

  // pessoas que o indicador manda; o admin aceita e a pessoa vira cliente
  await knex.schema.createTable('indicacoes', (t) => {
    t.increments('id')
    t.integer('indicador_id').notNullable().references('id').inTable('indicadores')
    t.string('nome', 160).notNullable()
    t.string('fone', 20).notNullable()
    t.string('interesse', 160)
    t.text('obs')
    t.text('status').notNullable().defaultTo('PENDENTE')
    t.integer('cliente_id').references('id').inTable('clientes').onDelete('SET NULL')
    t.timestamps(true, true)
    t.index(['indicador_id'])
  })
  await knex.raw("alter table indicacoes add constraint indicacoes_status_ck check (status in ('PENDENTE','ACEITA','RECUSADA'))")
}

export async function down(knex: Knex) {
  for (const t of ['indicacoes', 'niveis_indicador', 'repasses_indicador']) await knex.schema.dropTableIfExists(t)
}
