import type { Knex } from 'knex'

/**
 * O check de `saiu_da_conta_valor <= capital` quebrava a unificação de empréstimos: ela zera o `capital` da origem
 * (o dinheiro vai para o empréstimo novo) e o banco recusava. O serviço já valida `valor <= capital` ao criar o empréstimo;
 * o banco guarda só o que sempre vale: valor >= 0 e, se há valor, há de qual indicador saiu.
 */
export async function up(knex: Knex) {
  await knex.raw('alter table emprestimos drop constraint if exists emprestimos_saiu_da_conta_ck')
  await knex.raw(`alter table emprestimos add constraint emprestimos_saiu_da_conta_ck
    check (saiu_da_conta_valor >= 0 and (saiu_da_conta_valor = 0 or saiu_da_conta_indicador_id is not null))`)
}

export async function down(knex: Knex) {
  await knex.raw('alter table emprestimos drop constraint if exists emprestimos_saiu_da_conta_ck')
  await knex.raw(`alter table emprestimos add constraint emprestimos_saiu_da_conta_ck
    check (saiu_da_conta_valor >= 0 and saiu_da_conta_valor <= capital and (saiu_da_conta_valor = 0 or saiu_da_conta_indicador_id is not null))`)
}
