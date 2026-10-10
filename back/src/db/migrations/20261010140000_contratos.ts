import type { Knex } from 'knex'

export async function up(knex: Knex) {
  // versões do texto do contrato; a mais nova vale para as vendas novas (sem linha nenhuma vale o texto padrão do sistema)
  await knex.schema.createTable('contrato_modelos', (t) => {
    t.increments('id')
    t.integer('versao').notNullable().unique()
    t.text('texto').notNullable()
    t.integer('criado_por').references('id').inTable('users').onDelete('SET NULL')
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now())
  })
  // um contrato por venda; o texto só congela quando é marcado como enviado
  await knex.schema.createTable('contratos', (t) => {
    t.increments('id')
    t.integer('venda_id').notNullable().unique().references('id').inTable('vendas').onDelete('CASCADE')
    t.string('numero', 20).notNullable().unique()
    t.integer('modelo_versao').notNullable().defaultTo(0)
    t.boolean('seguro').notNullable().defaultTo(false)
    t.timestamp('gerado_em').notNullable().defaultTo(knex.fn.now())
    t.timestamp('enviado_em')
    t.timestamp('assinado_em')
    t.text('texto_enviado')
    t.integer('criado_por').references('id').inTable('users').onDelete('SET NULL')
  })
  // venda antiga (migrada) não tinha contrato: não conta como pendente
  await knex.raw('alter table vendas drop constraint vendas_contrato_ck')
  await knex.raw("alter table vendas add constraint vendas_contrato_ck check (contrato_status in ('AGUARDANDO','ENVIADO','ASSINADO','SEM_CONTRATO'))")
  await knex('vendas').whereNotNull('legacy_id').update({ contrato_status: 'SEM_CONTRATO' })
}

export async function down(knex: Knex) {
  await knex('vendas').where({ contrato_status: 'SEM_CONTRATO' }).update({ contrato_status: 'AGUARDANDO' })
  await knex.raw('alter table vendas drop constraint vendas_contrato_ck')
  await knex.raw("alter table vendas add constraint vendas_contrato_ck check (contrato_status in ('AGUARDANDO','ENVIADO','ASSINADO'))")
  await knex.schema.dropTableIfExists('contratos')
  await knex.schema.dropTableIfExists('contrato_modelos')
}
