/// <reference types="vite/client" />
import knex from 'knex'
import { URL_TESTE } from '../helpers/db.js'

/** Antes de todos os testes: cria o banco `mundo_iphones_test` (se faltar) e aplica as migrations. Sem Postgres, não faz nada. */
export default async function setup() {
  const url = new URL(URL_TESTE)
  const nome = url.pathname.slice(1)
  if (!/^[a-z0-9_]+$/.test(nome)) throw new Error('Nome de banco de teste inválido')

  const admin = knex({ client: 'pg', connection: URL_TESTE.replace(`/${nome}`, '/postgres'), pool: { min: 0, max: 1 }, acquireConnectionTimeout: 2000 })
  try {
    const existe = await admin.raw('select 1 from pg_database where datname = ?', [nome])
    if (!existe.rows.length) await admin.raw(`create database ${nome}`)
  } catch {
    return // sem Postgres: os testes de integração se pulam sozinhos
  } finally {
    await admin.destroy()
  }

  const db = knex({ client: 'pg', connection: URL_TESTE })
  try {
    // o Vite carrega os .ts das migrations (o Node puro não importa .ts)
    const modulos = import.meta.glob('../../src/db/migrations/*.ts') as Record<string, () => Promise<never>>
    await db.migrate.latest({
      migrationSource: {
        getMigrations: async () => Object.keys(modulos).sort(),
        getMigrationName: (m: string) => m.split('/').pop()!,
        getMigration: (m: string) => modulos[m](),
      },
    })
  } finally {
    await db.destroy()
  }
}
