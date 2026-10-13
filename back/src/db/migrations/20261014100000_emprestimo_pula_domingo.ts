import type { Knex } from 'knex'

export async function up(knex: Knex) {
  // diária: o administrador escolhe se o domingo conta (padrão: pula). Só vale para a modalidade diária; nas outras fica sempre true.
  await knex.schema.alterTable('emprestimos', (t) => { t.boolean('pula_domingo').notNullable().defaultTo(true) })
  // as diárias que vieram do sistema antigo guardam o que as datas já mostram: se tem parcela em domingo, o domingo contava
  await knex.raw(`
    update emprestimos set pula_domingo = not exists (
      select 1 from emprestimo_parcelas p where p.emprestimo_id = emprestimos.id and extract(dow from p.vencimento) = 0
    ) where periodicidade = 'DIARIA' and legacy_id is not null
  `)
}

export async function down(knex: Knex) {
  await knex.schema.alterTable('emprestimos', (t) => { t.dropColumn('pula_domingo') })
}
