import type { Knex } from 'knex'

/**
 * Novo tipo de pedido: BAIXA. O indicador AVISA que recebeu uma parcela (valor, data, forma, comprovante opcional em `dados`);
 * só vira recebimento quando o administrador confirma. Um aviso esperando por parcela.
 */
export async function up(knex: Knex) {
  await knex.raw('alter table aprovacoes drop constraint if exists aprovacoes_tipo_ck')
  await knex.raw("alter table aprovacoes add constraint aprovacoes_tipo_ck check (tipo in ('DESCONTO','ACORDO','RETOMADA','BAIXA'))")
  await knex.raw("create unique index aprovacoes_pendente_baixa_venda_uq on aprovacoes (venda_parcela_id) where status = 'PENDENTE' and tipo = 'BAIXA' and venda_parcela_id is not null")
  await knex.raw("create unique index aprovacoes_pendente_baixa_emp_uq on aprovacoes (emprestimo_parcela_id) where status = 'PENDENTE' and tipo = 'BAIXA' and emprestimo_parcela_id is not null")
}

export async function down(knex: Knex) {
  await knex('aprovacoes').where({ tipo: 'BAIXA' }).del()
  await knex.raw('drop index if exists aprovacoes_pendente_baixa_emp_uq')
  await knex.raw('drop index if exists aprovacoes_pendente_baixa_venda_uq')
  await knex.raw('alter table aprovacoes drop constraint if exists aprovacoes_tipo_ck')
  await knex.raw("alter table aprovacoes add constraint aprovacoes_tipo_ck check (tipo in ('DESCONTO','ACORDO','RETOMADA'))")
}
