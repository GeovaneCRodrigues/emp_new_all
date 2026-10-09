import type { Knex } from 'knex'

export async function up(knex: Knex) {
  // o cliente que o indicador cadastra já nasce vinculado a ele
  await knex.schema.alterTable('clientes', (t) => {
    t.integer('indicador_id').references('id').inTable('indicadores').onDelete('SET NULL')
    t.index(['indicador_id'])
  })

  // `indicacoes` vira a proposta do indicador: sempre uma INTENÇÃO sobre um cliente dele; a loja só aceita ou recusa
  // e cadastra a venda/empréstimo. (A tabela ainda não era usada, então começa limpa.)
  await knex('indicacoes').del()
  await knex.schema.alterTable('indicacoes', (t) => {
    t.dropColumn('nome')
    t.dropColumn('fone')
  })
  await knex.raw('alter table indicacoes alter column cliente_id set not null')
  await knex.raw('alter table indicacoes drop constraint if exists indicacoes_status_ck')
  await knex.raw('alter table indicacoes drop constraint if exists indicacoes_cliente_id_foreign')
  await knex.schema.alterTable('indicacoes', (t) => {
    t.foreign('cliente_id').references('id').inTable('clientes').onDelete('CASCADE')
    t.text('tipo').notNullable()
    t.integer('aparelho_id').references('id').inTable('bens').onDelete('SET NULL')
    t.decimal('valor', 15, 2)
    t.integer('parcelas')
    t.text('motivo_recusa')
    t.integer('respondido_por').references('id').inTable('users').onDelete('SET NULL')
    t.timestamp('respondido_em')
    // a venda ou o empréstimo que a loja cadastrou a partir da proposta
    t.integer('venda_id').references('id').inTable('vendas').onDelete('SET NULL')
    t.integer('emprestimo_id').references('id').inTable('emprestimos').onDelete('SET NULL')
  })
  await knex.raw("alter table indicacoes add constraint indicacoes_status_ck check (status in ('PENDENTE','ACEITA','RECUSADA','CANCELADA'))")
  await knex.raw("alter table indicacoes add constraint indicacoes_tipo_ck check (tipo in ('VENDA','EMPRESTIMO'))")
  await knex.raw('alter table indicacoes add constraint indicacoes_valor_ck check (valor is null or valor > 0)')
  await knex.raw('alter table indicacoes add constraint indicacoes_parcelas_ck check (parcelas is null or (parcelas between 1 and 120))')
  await knex.raw('alter table indicacoes add constraint indicacoes_uma_operacao_ck check (venda_id is null or emprestimo_id is null)')
  await knex.raw('create unique index indicacoes_venda_uq on indicacoes (venda_id) where venda_id is not null')
  await knex.raw('create unique index indicacoes_emprestimo_uq on indicacoes (emprestimo_id) where emprestimo_id is not null')
  await knex.raw('create index indicacoes_status_idx on indicacoes (status)')
}

export async function down(knex: Knex) {
  await knex('indicacoes').del()
  await knex.raw('drop index if exists indicacoes_status_idx, indicacoes_emprestimo_uq, indicacoes_venda_uq')
  for (const c of ['indicacoes_uma_operacao_ck', 'indicacoes_parcelas_ck', 'indicacoes_valor_ck', 'indicacoes_tipo_ck', 'indicacoes_status_ck']) await knex.raw(`alter table indicacoes drop constraint if exists ${c}`)
  await knex.schema.alterTable('indicacoes', (t) => {
    for (const c of ['emprestimo_id', 'venda_id', 'respondido_em', 'respondido_por', 'motivo_recusa', 'parcelas', 'valor', 'aparelho_id', 'tipo']) t.dropColumn(c)
    t.string('nome', 160).notNullable().defaultTo('')
    t.string('fone', 20).notNullable().defaultTo('')
  })
  await knex.raw('alter table indicacoes alter column cliente_id drop not null')
  await knex.raw("alter table indicacoes add constraint indicacoes_status_ck check (status in ('PENDENTE','ACEITA','RECUSADA'))")
  await knex.schema.alterTable('clientes', (t) => { t.dropIndex(['indicador_id']); t.dropColumn('indicador_id') })
}
