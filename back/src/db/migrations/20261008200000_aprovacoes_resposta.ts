import type { Knex } from 'knex'

export async function up(knex: Knex) {
  await knex.schema.alterTable('aprovacoes', (t) => { t.text('resposta') })
  // um desconto pendente por parcela: pedir de novo enquanto o primeiro espera não faz sentido
  await knex.raw("create unique index aprovacoes_pendente_parcela_uq on aprovacoes (venda_parcela_id) where status = 'PENDENTE' and tipo = 'DESCONTO' and venda_parcela_id is not null")
}

export async function down(knex: Knex) {
  await knex.raw('drop index if exists aprovacoes_pendente_parcela_uq')
  await knex.schema.alterTable('aprovacoes', (t) => { t.dropColumn('resposta') })
}
