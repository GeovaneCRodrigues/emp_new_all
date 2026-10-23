import type { Knex } from 'knex'

/**
 * Conta corrente do indicador com a loja (etapa 1). O saldo não é gravado: é calculado de
 *  - `transacoes_recebimento.cobrado_por_indicador_id` (o dinheiro ficou com o indicador),
 *  - `movimentacoes_caixa` tipo TRANSFERENCIA_INDICADOR (ele enviou à loja),
 *  - `emprestimos.saiu_da_conta_*` (o empréstimo foi pago com o dinheiro que está na conta dele).
 * O Caixa não tira da loja a parte do empréstimo que saiu da conta do indicador.
 */
export async function up(knex: Knex) {
  await knex.schema.alterTable('emprestimos', (t) => {
    t.integer('saiu_da_conta_indicador_id').references('id').inTable('indicadores')
    t.decimal('saiu_da_conta_valor', 15, 2).notNullable().defaultTo(0)
  })
  await knex.raw(`alter table emprestimos add constraint emprestimos_saiu_da_conta_ck
    check (saiu_da_conta_valor >= 0 and saiu_da_conta_valor <= capital and (saiu_da_conta_valor = 0 or saiu_da_conta_indicador_id is not null))`)
}

export async function down(knex: Knex) {
  await knex.raw('alter table emprestimos drop constraint if exists emprestimos_saiu_da_conta_ck')
  await knex.schema.alterTable('emprestimos', (t) => {
    t.dropColumn('saiu_da_conta_valor')
    t.dropColumn('saiu_da_conta_indicador_id')
  })
}
