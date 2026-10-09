import type { Knex } from 'knex'

/**
 * Empréstimo "só juros": um pagamento a mais amortiza o capital e recalcula o juro das parcelas seguintes.
 * `ajustes` guarda o que mudou fora da parcela paga (valor antes/depois de cada parcela e quanto foi amortizado),
 * para o "desfazer" devolver tudo como estava e para saber o capital que ainda está em aberto.
 */
export async function up(knex: Knex) {
  await knex.schema.alterTable('transacoes_recebimento', (t) => { t.jsonb('ajustes') })
}

export async function down(knex: Knex) {
  await knex.schema.alterTable('transacoes_recebimento', (t) => { t.dropColumn('ajustes') })
}
