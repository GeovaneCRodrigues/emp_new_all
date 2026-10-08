import type { Knex } from 'knex'

export async function up(knex: Knex) {
  await knex.schema.alterTable('vendas', (t) => {
    // preço combinado com o cliente (o preço de tabela do aparelho pode mudar depois)
    t.decimal('preco_acordado', 15, 2).notNullable().defaultTo(0)
    // % de juros por parcela vigente no dia da venda (a configuração pode mudar depois)
    t.decimal('juros_pct', 5, 2).notNullable().defaultTo(0)
  })
  // o mesmo aparelho não pode estar em duas vendas que contam (a venda cancelada libera o aparelho)
  await knex.raw("create unique index vendas_bem_ativa_uq on vendas (bem_id) where status <> 'CANCELADA'")
}

export async function down(knex: Knex) {
  await knex.raw('drop index if exists vendas_bem_ativa_uq')
  await knex.schema.alterTable('vendas', (t) => { t.dropColumn('preco_acordado'); t.dropColumn('juros_pct') })
}
