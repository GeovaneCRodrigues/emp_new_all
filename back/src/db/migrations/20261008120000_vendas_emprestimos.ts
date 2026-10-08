import type { Knex } from 'knex'

const pctCk = (t: string, c: string) => `alter table ${t} add constraint ${t}_${c}_ck check (${c} >= 0 and ${c} <= 1)`

export async function up(knex: Knex) {
  await knex.schema.createTable('vendas', (t) => {
    t.increments('id')
    t.integer('bem_id').notNullable().references('id').inTable('bens')
    t.integer('cliente_id').notNullable().references('id').inTable('clientes')
    t.integer('vendedor_id').references('id').inTable('users').onDelete('SET NULL')
    t.integer('indicador_id').references('id').inTable('indicadores').onDelete('SET NULL')
    // % do indicador congelado na hora da venda: mudar o indicador depois não altera vendas antigas
    t.decimal('percentual_indicador', 5, 4).notNullable().defaultTo(0)
    t.date('data_venda').notNullable()
    t.decimal('entrada', 15, 2).notNullable().defaultTo(0)
    t.decimal('troca_valor', 15, 2).notNullable().defaultTo(0)
    t.integer('troca_bem_id').references('id').inTable('bens').onDelete('SET NULL')
    // custo do aparelho no dia da venda (valor_compra + extras), para o lucro não mudar se o custo for corrigido depois
    t.decimal('valor_investido', 15, 2).notNullable()
    t.decimal('valor_total', 15, 2).notNullable()
    t.text('status').notNullable().defaultTo('ATIVA')
    t.text('contrato_status').notNullable().defaultTo('AGUARDANDO')
    t.text('observacoes')
    t.timestamps(true, true)
    t.index(['cliente_id'])
    t.index(['indicador_id'])
    t.index(['status'])
  })
  await knex.raw("alter table vendas add constraint vendas_status_ck check (status in ('ATIVA','QUITADA','RETOMADA','CANCELADA'))")
  await knex.raw("alter table vendas add constraint vendas_contrato_ck check (contrato_status in ('AGUARDANDO','ENVIADO','ASSINADO'))")
  await knex.raw(pctCk('vendas', 'percentual_indicador'))

  await knex.schema.createTable('venda_parcelas', (t) => {
    t.increments('id')
    t.integer('venda_id').notNullable().references('id').inTable('vendas').onDelete('CASCADE')
    t.integer('numero').notNullable()
    t.date('vencimento').notNullable()
    // vencimento antes de uma remarcação do restante
    t.date('vencimento_original')
    t.decimal('valor', 15, 2).notNullable()
    t.decimal('desconto', 15, 2).notNullable().defaultTo(0)
    t.date('quitada_em')
    t.timestamps(true, true)
    t.unique(['venda_id', 'numero'])
    t.index(['vencimento'])
  })

  await knex.schema.createTable('emprestimos', (t) => {
    t.increments('id')
    t.integer('cliente_id').notNullable().references('id').inTable('clientes')
    t.integer('indicador_id').references('id').inTable('indicadores').onDelete('SET NULL')
    t.decimal('percentual_indicador', 5, 4).notNullable().defaultTo(0)
    t.date('data_emprestimo').notNullable()
    t.decimal('capital', 15, 2).notNullable()
    t.text('modalidade').notNullable()
    // % ao mês (parcelado e só juros) ou do período (diária)
    t.decimal('taxa', 7, 4).notNullable()
    t.text('status').notNullable().defaultTo('ATIVA')
    t.text('observacoes')
    t.timestamps(true, true)
    t.index(['cliente_id'])
    t.index(['indicador_id'])
  })
  await knex.raw("alter table emprestimos add constraint emprestimos_modalidade_ck check (modalidade in ('PARCELADO','JUROS','DIARIA'))")
  await knex.raw("alter table emprestimos add constraint emprestimos_status_ck check (status in ('ATIVA','QUITADA','CANCELADA'))")
  await knex.raw(pctCk('emprestimos', 'percentual_indicador'))

  await knex.schema.createTable('emprestimo_parcelas', (t) => {
    t.increments('id')
    t.integer('emprestimo_id').notNullable().references('id').inTable('emprestimos').onDelete('CASCADE')
    t.integer('numero').notNullable()
    t.date('vencimento').notNullable()
    t.date('vencimento_original')
    t.decimal('valor', 15, 2).notNullable()
    t.decimal('desconto', 15, 2).notNullable().defaultTo(0)
    t.date('quitada_em')
    t.timestamps(true, true)
    t.unique(['emprestimo_id', 'numero'])
    t.index(['vencimento'])
  })
}

export async function down(knex: Knex) {
  for (const t of ['emprestimo_parcelas', 'emprestimos', 'venda_parcelas', 'vendas']) await knex.schema.dropTableIfExists(t)
}
