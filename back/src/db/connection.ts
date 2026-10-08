import knex, { type Knex } from 'knex'
import type { Env } from '../config/env.js'

export type Db = { knex: Knex; ping(): Promise<void>; close(): Promise<void> }

export function createDb(env: Pick<Env, 'DATABASE_URL' | 'DB_POOL_MAX'>): Db {
  const pool = knex({
    client: 'pg',
    connection: env.DATABASE_URL,
    // quem espera por uma conexão desiste em poucos segundos, e nenhuma consulta roda para sempre
    acquireConnectionTimeout: 5000,
    pool: {
      min: 0,
      max: env.DB_POOL_MAX,
      afterCreate: (conn: { query(sql: string, cb: (err: Error | null) => void): void }, done: (err: Error | null, conn: unknown) => void) => {
        conn.query('set statement_timeout = 10000', (err) => done(err, conn))
      },
    },
  })
  return {
    knex: pool,
    async ping() { await pool.raw('select 1') },
    async close() { await pool.destroy() },
  }
}
