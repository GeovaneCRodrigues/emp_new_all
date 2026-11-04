import type { Knex } from 'knex'

/**
 * Contrato com assinatura pelo link.
 *  - bens.serie: número de série do aparelho (vai no contrato).
 *  - clientes: endereço dividido (o `endereco` antigo continua sendo a rua/texto livre; nada é apagado nem reescrito).
 *  - contratos: link único (só o hash do token é guardado), validade e contagem de erros de CPF.
 *  - contrato_assinaturas: a assinatura desenhada e a prova (CPF conferido, IP, aparelho, hash do texto).
 */
export async function up(knex: Knex) {
  await knex.schema.alterTable('bens', (t) => { t.string('serie', 40) })
  await knex.schema.alterTable('clientes', (t) => {
    t.string('numero', 20)
    t.string('bairro', 100)
    t.string('cidade', 100)
    t.string('uf', 2)
    t.string('cep', 8)
  })
  await knex.schema.alterTable('contratos', (t) => {
    t.string('link_hash', 64).unique()
    t.timestamp('link_expira_em')
    t.integer('link_tentativas').notNullable().defaultTo(0)
  })
  await knex.schema.createTable('contrato_assinaturas', (t) => {
    t.increments('id')
    t.integer('contrato_id').notNullable().unique().references('id').inTable('contratos').onDelete('CASCADE')
    t.text('imagem').notNullable()
    t.string('cpf', 14).notNullable()
    t.string('texto_hash', 64).notNullable()
    t.string('ip', 64)
    t.text('user_agent')
    t.timestamp('assinado_em').notNullable().defaultTo(knex.fn.now())
  })
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists('contrato_assinaturas')
  await knex.schema.alterTable('contratos', (t) => { t.dropColumn('link_hash'); t.dropColumn('link_expira_em'); t.dropColumn('link_tentativas') })
  await knex.schema.alterTable('clientes', (t) => { t.dropColumn('numero'); t.dropColumn('bairro'); t.dropColumn('cidade'); t.dropColumn('uf'); t.dropColumn('cep') })
  await knex.schema.alterTable('bens', (t) => { t.dropColumn('serie') })
}
