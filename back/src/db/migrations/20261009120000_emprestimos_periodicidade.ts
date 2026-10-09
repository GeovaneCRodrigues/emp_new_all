import type { Knex } from 'knex'

/**
 * Regra nova do empréstimo (plano de 09/10): o juro do parcelado e da diária é % NO TOTAL (não mais % ao mês) e o
 * pagamento tem frequência (mensal, quinzenal, semanal ou diária). Os empréstimos que já existem são convertidos
 * sem mudar nenhum valor: o % ao mês antigo vezes o número de parcelas é o % no total.
 */
export async function up(knex: Knex) {
  await knex.schema.alterTable('emprestimos', (t) => { t.text('periodicidade').notNullable().defaultTo('MENSAL') })
  await knex.raw("update emprestimos set periodicidade = 'DIARIA' where modalidade = 'DIARIA'")
  await knex.raw("update emprestimos e set taxa = e.taxa * (select count(*) from emprestimo_parcelas p where p.emprestimo_id = e.id) where e.modalidade = 'PARCELADO'")
  await knex.raw("alter table emprestimos add constraint emprestimos_periodicidade_ck check (periodicidade in ('MENSAL','QUINZENAL','SEMANAL','DIARIA') and ((modalidade = 'DIARIA') = (periodicidade = 'DIARIA')))")
}

export async function down(knex: Knex) {
  await knex.raw('alter table emprestimos drop constraint if exists emprestimos_periodicidade_ck')
  await knex.raw("update emprestimos e set taxa = e.taxa / greatest((select count(*) from emprestimo_parcelas p where p.emprestimo_id = e.id), 1) where e.modalidade = 'PARCELADO'")
  await knex.schema.alterTable('emprestimos', (t) => { t.dropColumn('periodicidade') })
}
