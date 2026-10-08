import knex, { type Knex } from 'knex'

export const URL_TESTE = process.env.DATABASE_URL_TESTE ?? 'postgres://mundo:mundo@localhost:5440/mundo_iphones_test'

/** Conexão com o banco de teste, ou null se o Postgres não está no ar (os testes de integração então são pulados). */
export async function bancoDeTeste(): Promise<Knex | null> {
  const db = knex({ client: 'pg', connection: URL_TESTE, pool: { min: 0, max: 4 }, acquireConnectionTimeout: 2000 })
  try {
    await db.raw('select 1')
    return db
  } catch {
    await db.destroy()
    return null
  }
}

/** Esvazia todas as tabelas do negócio (menos as de configuração com dados iniciais). */
export async function limparBanco(db: Knex) {
  await db.raw(`truncate table auditoria, sessoes, recebimentos, transacoes_recebimento, aprovacoes, fechamentos_caixa,
    movimentacoes_caixa, repasses_indicador, indicacoes, emprestimo_parcelas, emprestimos, venda_parcelas, vendas, bens,
    clientes, users, indicadores restart identity cascade`)
}
