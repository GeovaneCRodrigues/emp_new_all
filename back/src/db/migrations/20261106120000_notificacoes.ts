import type { Knex } from 'knex'

/** Avisos dentro do app (o sino): um por pessoa. A chave evita avisar duas vezes do mesmo fato. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('notificacoes', (t) => {
    t.increments('id')
    t.integer('usuario_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.string('tipo', 40).notNullable()
    t.text('texto').notNullable()
    /** tela do app que o aviso abre */
    t.string('rota', 80)
    t.string('chave', 120).notNullable()
    t.boolean('lida').notNullable().defaultTo(false)
    t.timestamp('criada_em', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.unique(['usuario_id', 'chave'])
    t.index(['usuario_id', 'lida', 'id'])
  })
  // até onde a trilha de auditoria já virou aviso
  await knex.schema.createTable('notificacoes_estado', (t) => {
    t.string('chave', 40).primary()
    t.bigInteger('valor').notNullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('notificacoes_estado')
  await knex.schema.dropTable('notificacoes')
}
