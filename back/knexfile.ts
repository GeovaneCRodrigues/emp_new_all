import 'dotenv/config'

export default {
  client: 'pg',
  connection: process.env.DATABASE_URL,
  migrations: { directory: './src/db/migrations', extension: 'ts' },
}
