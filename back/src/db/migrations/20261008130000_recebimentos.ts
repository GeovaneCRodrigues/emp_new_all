import type { Knex } from 'knex'

export async function up(knex: Knex) {
  // Uma transação é um recebimento inteiro: pode cobrir várias parcelas, gera um recibo e tem um "desfazer".
  await knex.schema.createTable('transacoes_recebimento', (t) => {
    t.increments('id')
    t.integer('numero_recibo').notNullable().unique()
    t.integer('cliente_id').notNullable().references('id').inTable('clientes')
    t.decimal('valor_total', 15, 2).notNullable()
    t.text('forma_pagamento').notNullable()
    t.date('data_recebimento').notNullable()
    t.integer('recebido_por').references('id').inTable('users').onDelete('SET NULL')
    t.timestamp('desfeita_em')
    t.integer('desfeita_por').references('id').inTable('users').onDelete('SET NULL')
    t.timestamps(true, true)
    t.index(['recebido_por', 'data_recebimento'])
  })
  await knex.raw("alter table transacoes_recebimento add constraint transacoes_forma_ck check (forma_pagamento in ('PIX','DINHEIRO','CARTAO'))")
  await knex.raw('create sequence recibo_numero_seq start 1')

  await knex.schema.createTable('recebimentos', (t) => {
    t.increments('id')
    t.integer('transacao_id').notNullable().references('id').inTable('transacoes_recebimento').onDelete('CASCADE')
    // ENTRADA e TROCA pertencem à venda; PARCELA pertence a uma parcela de venda ou de empréstimo
    t.text('tipo').notNullable()
    t.integer('venda_id').references('id').inTable('vendas').onDelete('CASCADE')
    t.integer('venda_parcela_id').references('id').inTable('venda_parcelas').onDelete('CASCADE')
    t.integer('emprestimo_parcela_id').references('id').inTable('emprestimo_parcelas').onDelete('CASCADE')
    t.decimal('valor', 15, 2).notNullable()
    // estado da parcela antes do recebimento, para o "desfazer" voltar tudo como estava
    t.jsonb('antes')
    t.timestamps(true, true)
    t.index(['venda_parcela_id'])
    t.index(['emprestimo_parcela_id'])
  })
  await knex.raw("alter table recebimentos add constraint recebimentos_tipo_ck check (tipo in ('ENTRADA','TROCA','PARCELA'))")
  // cada recebimento aponta para exatamente uma coisa
  await knex.raw(`alter table recebimentos add constraint recebimentos_alvo_ck check (
    (tipo in ('ENTRADA','TROCA') and venda_id is not null and venda_parcela_id is null and emprestimo_parcela_id is null)
    or (tipo = 'PARCELA' and venda_id is null and (venda_parcela_id is null) <> (emprestimo_parcela_id is null))
  )`)
}

export async function down(knex: Knex) {
  await knex.schema.dropTableIfExists('recebimentos')
  await knex.raw('drop sequence if exists recibo_numero_seq')
  await knex.schema.dropTableIfExists('transacoes_recebimento')
}
