import type { Knex } from 'knex'

/**
 * Quais indicadores cada cobrador atende. O cobrador só enxerga as cobranças (parcelas, empréstimos, vendas, recibos)
 * das operações desses indicadores; sem nenhum marcado, não enxerga nada. Quem escolhe é o administrador.
 */
export async function up(knex: Knex) {
  await knex.schema.createTable('cobrador_indicadores', (t) => {
    t.integer('usuario_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
    t.integer('indicador_id').notNullable().references('id').inTable('indicadores').onDelete('CASCADE')
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    t.primary(['usuario_id', 'indicador_id'])
    t.index(['indicador_id'])
  })
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists('cobrador_indicadores')
}
