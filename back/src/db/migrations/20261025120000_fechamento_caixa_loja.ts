import type { Knex } from 'knex'

/**
 * O fechamento do caixa da loja: o dono marca "fechei o caixa até o dia X". Não guarda valores (o extrato já os tem):
 * só o dia, quem fechou, quando e uma observação. Pode fechar várias vezes; o último é o de maior id.
 * É outra coisa que `fechamentos_caixa`, o "fechar o dia" de cada cobrador.
 */
export async function up(knex: Knex) {
  await knex.schema.createTable('fechamentos_caixa_loja', (t) => {
    t.increments('id')
    t.date('dia').notNullable()
    t.text('obs')
    t.integer('usuario_id').notNullable().references('id').inTable('users')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.index(['dia'])
  })
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists('fechamentos_caixa_loja')
}
