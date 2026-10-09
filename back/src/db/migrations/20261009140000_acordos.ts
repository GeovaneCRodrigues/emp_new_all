import type { Knex } from 'knex'

/**
 * Acordo: renegocia o que falta de uma venda ou de um empréstimo em parcelas novas.
 *  - as parcelas abertas viram "encerradas por acordo" (ficam só com o que já foi pago) e as novas continuam a numeração;
 *  - `acordos` guarda o saldo de antes e as parcelas substituídas, para consulta e auditoria;
 *  - o pedido do cobrador leva a proposta em `aprovacoes.dados`; um pedido de acordo pendente por venda/empréstimo.
 */
export async function up(knex: Knex) {
  await knex.schema.createTable('acordos', (t) => {
    t.increments('id')
    t.integer('venda_id').references('id').inTable('vendas').onDelete('CASCADE')
    t.integer('emprestimo_id').references('id').inTable('emprestimos').onDelete('CASCADE')
    t.integer('criado_por').references('id').inTable('users').onDelete('SET NULL')
    t.integer('aprovacao_id').references('id').inTable('aprovacoes').onDelete('SET NULL')
    t.date('data_acordo').notNullable()
    t.decimal('saldo_antes', 15, 2).notNullable()
    t.decimal('valor_total', 15, 2).notNullable()
    t.integer('n_parcelas').notNullable()
    t.date('primeira_parcela').notNullable()
    t.text('motivo')
    t.jsonb('parcelas_antes').notNullable()
    t.text('status').notNullable().defaultTo('ATIVO')
    t.timestamps(true, true)
    t.index(['venda_id'])
    t.index(['emprestimo_id'])
  })
  await knex.raw('alter table acordos add constraint acordos_alvo_ck check (num_nonnulls(venda_id, emprestimo_id) = 1)')
  await knex.raw("alter table acordos add constraint acordos_status_ck check (status in ('ATIVO','SUBSTITUIDO'))")
  await knex.raw("create unique index acordos_ativo_venda_uq on acordos (venda_id) where status = 'ATIVO' and venda_id is not null")
  await knex.raw("create unique index acordos_ativo_emprestimo_uq on acordos (emprestimo_id) where status = 'ATIVO' and emprestimo_id is not null")

  for (const tabela of ['venda_parcelas', 'emprestimo_parcelas']) {
    await knex.schema.alterTable(tabela, (t) => {
      /** parcela criada por um acordo */
      t.integer('acordo_id').references('id').inTable('acordos').onDelete('SET NULL')
      /** parcela que um acordo encerrou (ficou só com o que já foi pago) */
      t.integer('encerrada_acordo_id').references('id').inTable('acordos').onDelete('SET NULL')
    })
  }

  await knex.schema.alterTable('aprovacoes', (t) => { t.jsonb('dados') })
  await knex.raw("create unique index aprovacoes_pendente_acordo_venda_uq on aprovacoes (venda_id) where status = 'PENDENTE' and tipo = 'ACORDO' and venda_id is not null")
  await knex.raw("create unique index aprovacoes_pendente_acordo_emp_uq on aprovacoes (emprestimo_id) where status = 'PENDENTE' and tipo = 'ACORDO' and emprestimo_id is not null")
}

export async function down(knex: Knex) {
  await knex.raw('drop index if exists aprovacoes_pendente_acordo_emp_uq')
  await knex.raw('drop index if exists aprovacoes_pendente_acordo_venda_uq')
  await knex.schema.alterTable('aprovacoes', (t) => { t.dropColumn('dados') })
  for (const tabela of ['venda_parcelas', 'emprestimo_parcelas']) {
    await knex.schema.alterTable(tabela, (t) => { t.dropColumn('acordo_id'); t.dropColumn('encerrada_acordo_id') })
  }
  await knex.schema.dropTableIfExists('acordos')
}
