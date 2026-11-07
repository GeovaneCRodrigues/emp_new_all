import type { Knex } from 'knex'

/** Cópia do PDF assinado (baixada do ZapSign), guardada aqui para não depender de lá. O hash prova que o arquivo não mudou. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('contrato_arquivos', (t) => {
    t.integer('contrato_id').primary().references('id').inTable('contratos').onDelete('CASCADE')
    t.specificType('pdf', 'bytea').notNullable()
    t.string('sha256', 64).notNullable()
    t.integer('tamanho').notNullable()
    t.timestamp('baixado_em', { useTz: true }).notNullable().defaultTo(knex.fn.now())
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('contrato_arquivos')
}
