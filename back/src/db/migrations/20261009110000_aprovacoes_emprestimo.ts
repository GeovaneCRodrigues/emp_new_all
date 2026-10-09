import type { Knex } from 'knex'

/**
 * Pedidos do cobrador também valem para empréstimos: um pedido pendente por parcela de empréstimo
 * (como já era nas vendas) e cada pedido aponta para uma venda OU para um empréstimo, nunca os dois.
 */
export async function up(knex: Knex) {
  await knex.raw("create unique index aprovacoes_pendente_parcela_emp_uq on aprovacoes (emprestimo_parcela_id) where status = 'PENDENTE' and tipo = 'DESCONTO' and emprestimo_parcela_id is not null")
  await knex.raw('alter table aprovacoes add constraint aprovacoes_alvo_ck check (num_nonnulls(venda_id, emprestimo_id) = 1)')
}

export async function down(knex: Knex) {
  await knex.raw('alter table aprovacoes drop constraint if exists aprovacoes_alvo_ck')
  await knex.raw('drop index if exists aprovacoes_pendente_parcela_emp_uq')
}
