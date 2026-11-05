import type { Knex } from 'knex'

/** Aparelhos que aceitaram receber aviso com o app fechado (push). Um aparelho = um endpoint; se outra pessoa entrar nele, a inscrição muda de dono. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('push_inscricoes', (t) => {
    t.increments('id')
    t.integer('usuario_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.text('endpoint').notNullable().unique()
    t.text('p256dh').notNullable()
    t.text('auth').notNullable()
    t.string('user_agent', 300)
    t.timestamp('criada_em', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.index(['usuario_id'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('push_inscricoes')
}
