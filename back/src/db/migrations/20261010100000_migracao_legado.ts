import type { Knex } from 'knex'

/**
 * Preparação para trazer os dados do sistema antigo:
 *  - `legacy_id` guarda o id de cada cliente e indicador no sistema antigo (a migração roda de novo sem duplicar, e as
 *    operações da próxima etapa apontam para esses ids);
 *  - clientes ganham `email` e `observacoes` (só o administrador vê e edita).
 * Telefone vazio ('') quer dizer "sem telefone": vários clientes antigos não têm.
 */
export async function up(knex: Knex) {
  await knex.schema.alterTable('clientes', (t) => {
    t.integer('legacy_id')
    t.string('email', 255)
    t.text('observacoes')
  })
  await knex.schema.alterTable('indicadores', (t) => { t.integer('legacy_id') })
  await knex.raw('create unique index clientes_legacy_uq on clientes (legacy_id) where legacy_id is not null')
  await knex.raw('create unique index indicadores_legacy_uq on indicadores (legacy_id) where legacy_id is not null')
}

export async function down(knex: Knex) {
  await knex.raw('drop index if exists indicadores_legacy_uq')
  await knex.raw('drop index if exists clientes_legacy_uq')
  await knex.schema.alterTable('indicadores', (t) => { t.dropColumn('legacy_id') })
  await knex.schema.alterTable('clientes', (t) => { t.dropColumn('observacoes'); t.dropColumn('email'); t.dropColumn('legacy_id') })
}
