import type { Knex } from 'knex'

/** Documentos do cliente (CNH/RG, comprovante de residência, selfie...). O arquivo fica no banco, junto do backup; o hash prova que não mudou. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('cliente_documentos', (t) => {
    t.increments('id')
    t.integer('cliente_id').notNullable().references('id').inTable('clientes').onDelete('CASCADE')
    t.string('tipo', 30).notNullable()
    t.string('nome', 120).notNullable()
    t.string('mime', 40).notNullable()
    t.integer('tamanho').notNullable()
    t.string('sha256', 64).notNullable()
    t.specificType('conteudo', 'bytea').notNullable()
    t.integer('enviado_por').references('id').inTable('users').onDelete('SET NULL')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.index(['cliente_id'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('cliente_documentos')
}
