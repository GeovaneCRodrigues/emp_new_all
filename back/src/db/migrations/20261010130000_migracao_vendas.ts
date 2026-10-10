import type { Knex } from 'knex'

/**
 * Preparação para trazer o estoque e as vendas de iPhones do sistema antigo (mesma ideia da etapa de empréstimos):
 * `legacy_id` liga cada linha ao que existia lá, para a migração rodar de novo sem duplicar e para dar para conferir.
 * `transacoes_recebimento.legacy_venda_recebimento_id`: o recebimento de venda tem numeração própria no antigo (diferente da dos empréstimos).
 */
export async function up(knex: Knex) {
  await knex.schema.alterTable('bens', (t) => { t.integer('legacy_id') })
  await knex.raw('create unique index bens_legacy_uq on bens (legacy_id) where legacy_id is not null')
  await knex.schema.alterTable('vendas', (t) => { t.integer('legacy_id') })
  await knex.raw('create unique index vendas_legacy_uq on vendas (legacy_id) where legacy_id is not null')
  await knex.schema.alterTable('venda_parcelas', (t) => { t.integer('legacy_id') })
  await knex.schema.alterTable('transacoes_recebimento', (t) => { t.integer('legacy_venda_recebimento_id') })
  await knex.raw('create unique index transacoes_legacy_venda_uq on transacoes_recebimento (legacy_venda_recebimento_id) where legacy_venda_recebimento_id is not null')
}

export async function down(knex: Knex) {
  await knex.raw('drop index if exists transacoes_legacy_venda_uq')
  await knex.schema.alterTable('transacoes_recebimento', (t) => { t.dropColumn('legacy_venda_recebimento_id') })
  await knex.schema.alterTable('venda_parcelas', (t) => { t.dropColumn('legacy_id') })
  await knex.raw('drop index if exists vendas_legacy_uq')
  await knex.schema.alterTable('vendas', (t) => { t.dropColumn('legacy_id') })
  await knex.raw('drop index if exists bens_legacy_uq')
  await knex.schema.alterTable('bens', (t) => { t.dropColumn('legacy_id') })
}
