import type { Knex } from 'knex'

/**
 * Contrato enviado para assinar pelo ZapSign (alternativa ao link próprio).
 * Só adiciona colunas. `assinatura_via` diz como o contrato foi assinado: LINK (nosso), ZAPSIGN ou MANUAL (marcado à mão).
 */
export async function up(knex: Knex) {
  await knex.schema.alterTable('contratos', (t) => {
    t.string('zapsign_token', 80).unique()
    t.string('zapsign_signer_token', 80)
    t.text('zapsign_url')
    t.string('zapsign_status', 20)
    t.boolean('zapsign_sandbox')
    t.string('assinatura_via', 10)
  })
  await knex.raw("alter table contratos add constraint contratos_assinatura_via_ck check (assinatura_via is null or assinatura_via in ('LINK','ZAPSIGN','MANUAL'))")
  // o que já estava assinado por algum caminho
  await knex('contratos').whereNotNull('assinado_em').whereIn('id', knex('contrato_assinaturas').select('contrato_id')).update({ assinatura_via: 'LINK' })
  await knex('contratos').whereNotNull('assinado_em').whereNull('assinatura_via').update({ assinatura_via: 'MANUAL' })
}

export async function down(knex: Knex) {
  await knex.raw('alter table contratos drop constraint contratos_assinatura_via_ck')
  await knex.schema.alterTable('contratos', (t) => {
    t.dropColumn('zapsign_token'); t.dropColumn('zapsign_signer_token'); t.dropColumn('zapsign_url'); t.dropColumn('zapsign_status'); t.dropColumn('zapsign_sandbox'); t.dropColumn('assinatura_via')
  })
}
