import type { Knex } from 'knex'

export async function up(knex: Knex) {
  await knex.schema.createTable('clientes', (t) => {
    t.increments('id')
    t.string('nome', 160).notNullable()
    t.string('fone', 20).notNullable()
    t.string('cpf', 14)
    t.string('rg', 20)
    t.string('endereco', 500)
    t.string('origem', 60)
    // carteira: o cobrador/vendedor dono deste cliente
    t.integer('responsavel_id').references('id').inTable('users').onDelete('SET NULL')
    t.timestamps(true, true)
    t.index(['responsavel_id'])
  })
  await knex.raw('create unique index clientes_cpf_uq on clientes (cpf) where cpf is not null')

  await knex.schema.createTable('bens', (t) => {
    t.increments('id')
    t.string('modelo', 80).notNullable()
    t.integer('gb').notNullable()
    t.string('cor', 40).notNullable()
    t.integer('bateria').notNullable().defaultTo(100)
    t.text('condicao').notNullable().defaultTo('Seminovo')
    t.string('imei', 20)
    t.decimal('valor_compra', 15, 2).notNullable().defaultTo(0)
    t.decimal('custos_extras', 15, 2).notNullable().defaultTo(0)
    t.decimal('preco_venda', 15, 2).notNullable()
    t.text('estado').notNullable().defaultTo('DISPONIVEL')
    t.text('origem').notNullable().defaultTo('COMPRA')
    t.date('data_compra').notNullable()
    t.integer('cliente_encomenda_id').references('id').inTable('clientes').onDelete('SET NULL')
    t.text('observacoes')
    t.timestamps(true, true)
    t.index(['estado'])
  })
  await knex.raw("alter table bens add constraint bens_estado_ck check (estado in ('ENCOMENDADO','DISPONIVEL','VENDIDO'))")
  await knex.raw("alter table bens add constraint bens_origem_ck check (origem in ('COMPRA','TROCA'))")
  await knex.raw("alter table bens add constraint bens_condicao_ck check (condicao in ('Novo','Seminovo'))")
  await knex.raw('create unique index bens_imei_uq on bens (imei) where imei is not null')
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists('bens')
  await knex.schema.dropTableIfExists('clientes')
}
