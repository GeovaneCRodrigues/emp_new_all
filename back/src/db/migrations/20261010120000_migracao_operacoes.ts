import type { Knex } from 'knex'

/**
 * Preparação para trazer empréstimos e recebimentos do sistema antigo:
 *  - `legacy_id` (e `legacy_parcela`) ligam cada linha ao que existia lá: a migração roda de novo sem duplicar e dá para conferir;
 *  - `emprestimos.modo_divisao`: como o indicador participa. CAPITAL_PRIMEIRO (padrão): só depois que o capital voltou.
 *    JUROS_MENSAL (só juros): a cada pagamento, o % dele sobre os JUROS recebidos (o capital emprestado fica com a loja);
 *  - `transacoes_recebimento.cobrado_por_indicador_id`: o indicador que cobrou direto do cliente (o recebimento não passou
 *    pela mão da loja), e `forma_estimada`: o sistema antigo não registrava a forma de pagamento (o recibo sai como Pix);
 *  - o caixa passa a guardar as transferências que o indicador faz à loja (dinheiro que ele cobrou e repassou).
 */
export async function up(knex: Knex) {
  await knex.schema.alterTable('emprestimos', (t) => {
    t.integer('legacy_id')
    t.text('modo_divisao').notNullable().defaultTo('CAPITAL_PRIMEIRO')
  })
  await knex.raw("alter table emprestimos add constraint emprestimos_modo_divisao_ck check (modo_divisao in ('CAPITAL_PRIMEIRO','JUROS_MENSAL'))")
  await knex.raw('create unique index emprestimos_legacy_uq on emprestimos (legacy_id) where legacy_id is not null')

  await knex.schema.alterTable('emprestimo_parcelas', (t) => { t.text('legacy_parcela') })

  await knex.schema.alterTable('acordos', (t) => { t.integer('legacy_id') })
  await knex.raw('create unique index acordos_legacy_uq on acordos (legacy_id) where legacy_id is not null')

  await knex.schema.alterTable('transacoes_recebimento', (t) => {
    t.integer('legacy_id')
    t.integer('cobrado_por_indicador_id').references('id').inTable('indicadores').onDelete('SET NULL')
    t.boolean('forma_estimada').notNullable().defaultTo(false)
  })
  await knex.raw('create unique index transacoes_legacy_uq on transacoes_recebimento (legacy_id) where legacy_id is not null')

  await knex.schema.alterTable('repasses_indicador', (t) => { t.text('legacy_id') })
  await knex.raw('create unique index repasses_legacy_uq on repasses_indicador (legacy_id) where legacy_id is not null')

  await knex.schema.alterTable('movimentacoes_caixa', (t) => {
    t.text('legacy_id')
    t.integer('indicador_id').references('id').inTable('indicadores').onDelete('SET NULL')
  })
  await knex.raw('alter table movimentacoes_caixa drop constraint if exists movimentacoes_tipo_ck')
  await knex.raw("alter table movimentacoes_caixa add constraint movimentacoes_tipo_ck check (tipo in ('APORTE','RETIRADA','DESPESA','TRANSFERENCIA_INDICADOR'))")
  await knex.raw('create unique index movimentacoes_legacy_uq on movimentacoes_caixa (legacy_id) where legacy_id is not null')
}

export async function down(knex: Knex) {
  await knex.raw('drop index if exists movimentacoes_legacy_uq')
  await knex('movimentacoes_caixa').where({ tipo: 'TRANSFERENCIA_INDICADOR' }).del()
  await knex.raw('alter table movimentacoes_caixa drop constraint if exists movimentacoes_tipo_ck')
  await knex.raw("alter table movimentacoes_caixa add constraint movimentacoes_tipo_ck check (tipo in ('APORTE','RETIRADA','DESPESA'))")
  await knex.schema.alterTable('movimentacoes_caixa', (t) => { t.dropColumn('indicador_id'); t.dropColumn('legacy_id') })
  await knex.raw('drop index if exists repasses_legacy_uq')
  await knex.schema.alterTable('repasses_indicador', (t) => { t.dropColumn('legacy_id') })
  await knex.raw('drop index if exists transacoes_legacy_uq')
  await knex.schema.alterTable('transacoes_recebimento', (t) => { t.dropColumn('forma_estimada'); t.dropColumn('cobrado_por_indicador_id'); t.dropColumn('legacy_id') })
  await knex.raw('drop index if exists acordos_legacy_uq')
  await knex.schema.alterTable('acordos', (t) => { t.dropColumn('legacy_id') })
  await knex.schema.alterTable('emprestimo_parcelas', (t) => { t.dropColumn('legacy_parcela') })
  await knex.raw('drop index if exists emprestimos_legacy_uq')
  await knex.raw('alter table emprestimos drop constraint if exists emprestimos_modo_divisao_ck')
  await knex.schema.alterTable('emprestimos', (t) => { t.dropColumn('modo_divisao'); t.dropColumn('legacy_id') })
}
