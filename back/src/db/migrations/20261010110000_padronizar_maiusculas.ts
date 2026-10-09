import type { Knex } from 'knex'

/**
 * Cadastro padronizado em LETRAS MAIÚSCULAS (nomes e endereços), sem espaços sobrando.
 * Vale para o que já está no banco; o que entra depois é padronizado pelo próprio sistema.
 * (Não tem volta: não dá para saber como estava escrito antes.)
 */
export async function up(knex: Knex) {
  const limpa = (col: string) => `upper(regexp_replace(btrim(${col}), '\\s+', ' ', 'g'))`
  await knex.raw(`update clientes set nome = ${limpa('nome')}, endereco = case when endereco is null then null else ${limpa('endereco')} end, rg = case when rg is null then null else ${limpa('rg')} end`)
  await knex.raw(`update indicadores set nome = ${limpa('nome')}`)
  await knex.raw(`update users set nome = ${limpa('nome')}`)
}

export async function down() { /* sem volta */ }
