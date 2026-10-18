import type { Knex } from 'knex'

/**
 * O caixa passa a ter dois lados: empréstimos e iPhones. Aporte, retirada e despesa dizem de que lado são.
 * Os que já existem ficam sem lado (null): aparecem na aba "Sem lado" até o administrador escolher.
 */
export async function up(knex: Knex) {
  await knex.schema.alterTable('movimentacoes_caixa', (t) => { t.text('lado') })
  await knex.raw("alter table movimentacoes_caixa add constraint movimentacoes_lado_ck check (lado in ('EMPRESTIMO','IPHONE'))")
}

export async function down(knex: Knex) {
  await knex.raw('alter table movimentacoes_caixa drop constraint if exists movimentacoes_lado_ck')
  await knex.schema.alterTable('movimentacoes_caixa', (t) => { t.dropColumn('lado') })
}
