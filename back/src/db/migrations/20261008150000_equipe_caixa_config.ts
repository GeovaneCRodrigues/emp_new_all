import type { Knex } from 'knex'

export async function up(knex: Knex) {
  // Pedidos do cobrador: a ação só é aplicada quando o admin aprova.
  await knex.schema.createTable('aprovacoes', (t) => {
    t.increments('id')
    t.text('tipo').notNullable()
    t.integer('solicitado_por').notNullable().references('id').inTable('users')
    t.integer('venda_id').references('id').inTable('vendas').onDelete('CASCADE')
    t.integer('emprestimo_id').references('id').inTable('emprestimos').onDelete('CASCADE')
    t.integer('venda_parcela_id').references('id').inTable('venda_parcelas').onDelete('CASCADE')
    t.integer('emprestimo_parcela_id').references('id').inTable('emprestimo_parcelas').onDelete('CASCADE')
    t.decimal('valor', 15, 2)
    t.text('motivo')
    t.text('status').notNullable().defaultTo('PENDENTE')
    t.integer('respondido_por').references('id').inTable('users').onDelete('SET NULL')
    t.timestamp('respondido_em')
    t.timestamps(true, true)
    t.index(['status'])
    t.index(['solicitado_por'])
  })
  await knex.raw("alter table aprovacoes add constraint aprovacoes_tipo_ck check (tipo in ('DESCONTO','ACORDO','RETOMADA'))")
  await knex.raw("alter table aprovacoes add constraint aprovacoes_status_ck check (status in ('PENDENTE','APROVADO','RECUSADO'))")

  // "Fechar o dia" do cobrador: o admin confere.
  await knex.schema.createTable('fechamentos_caixa', (t) => {
    t.increments('id')
    t.integer('usuario_id').notNullable().references('id').inTable('users')
    t.date('data').notNullable()
    t.decimal('total_dinheiro', 15, 2).notNullable().defaultTo(0)
    t.decimal('total_pix', 15, 2).notNullable().defaultTo(0)
    t.decimal('total_cartao', 15, 2).notNullable().defaultTo(0)
    t.text('status').notNullable().defaultTo('PENDENTE')
    t.integer('conferido_por').references('id').inTable('users').onDelete('SET NULL')
    t.timestamp('conferido_em')
    t.timestamps(true, true)
    t.unique(['usuario_id', 'data'])
  })
  await knex.raw("alter table fechamentos_caixa add constraint fechamentos_status_ck check (status in ('PENDENTE','CONFERIDO'))")

  await knex.schema.createTable('movimentacoes_caixa', (t) => {
    t.increments('id')
    t.text('tipo').notNullable()
    t.decimal('valor', 15, 2).notNullable()
    t.date('data').notNullable()
    t.text('obs')
    t.integer('usuario_id').references('id').inTable('users').onDelete('SET NULL')
    t.timestamps(true, true)
    t.index(['data'])
  })
  await knex.raw("alter table movimentacoes_caixa add constraint movimentacoes_tipo_ck check (tipo in ('APORTE','RETIRADA','DESPESA'))")
  await knex.raw('alter table movimentacoes_caixa add constraint movimentacoes_valor_ck check (valor > 0)')

  // quem fez cada baixa, desconto, desfazer, mudança de vencimento e aprovação
  await knex.schema.createTable('auditoria', (t) => {
    t.bigIncrements('id')
    t.integer('usuario_id').references('id').inTable('users').onDelete('SET NULL')
    t.string('acao', 40).notNullable()
    t.string('entidade', 40).notNullable()
    t.integer('entidade_id')
    t.jsonb('antes')
    t.jsonb('depois')
    t.timestamp('criado_em').notNullable().defaultTo(knex.fn.now())
    t.index(['entidade', 'entidade_id'])
    t.index(['usuario_id'])
  })

  await knex.schema.createTable('sistema_config', (t) => {
    t.string('chave', 60).primary()
    t.jsonb('valor').notNullable()
    t.timestamps(true, true)
  })
  await knex('sistema_config').insert([
    // venda parcelada: 10% por parcela, juros simples, até 10x (configurável)
    { chave: 'juros_parcela_pct', valor: JSON.stringify(10) },
    { chave: 'max_parcelas', valor: JSON.stringify(10) },
    // % do indicador sobe sozinho com o nível (só se não foi definido à mão)
    { chave: 'niveis_auto', valor: JSON.stringify(true) },
  ])
}

export async function down(knex: Knex) {
  for (const t of ['sistema_config', 'auditoria', 'movimentacoes_caixa', 'fechamentos_caixa', 'aprovacoes']) await knex.schema.dropTableIfExists(t)
}
