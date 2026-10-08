import type { Knex } from 'knex'

export async function up(knex: Knex) {
  // Retrato do que o recibo mostra, tirado na hora do recebimento: reabrir o recibo depois não muda o que estava escrito.
  await knex.schema.alterTable('transacoes_recebimento', (t) => { t.jsonb('resumo') })
  await knex('sistema_config').insert([
    { chave: 'empresa_nome', valor: JSON.stringify('Mundo dos iPhones') },
    { chave: 'empresa_cnpj', valor: JSON.stringify(null) },
  ]).onConflict('chave').ignore()
}

export async function down(knex: Knex) {
  await knex('sistema_config').whereIn('chave', ['empresa_nome', 'empresa_cnpj']).del()
  await knex.schema.alterTable('transacoes_recebimento', (t) => { t.dropColumn('resumo') })
}
