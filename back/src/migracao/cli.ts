import 'dotenv/config'
import { parseEnv } from '../config/env.js'
import { createDb } from '../db/connection.js'
import { abrirFonteMysql } from './fonte-mysql.js'
import { formatarRelatorio, importar } from './importar.js'

/**
 * Traz indicadores e clientes do sistema antigo.
 *   OLD_MYSQL_URL=mysql://usuario:senha@127.0.0.1:3307/emp npm run migrar:legado             → só SIMULA (não grava nada)
 *   OLD_MYSQL_URL=... npm run migrar:legado -- --aplicar --confirmo=<nome do banco de destino>  → grava
 * Para gravar é preciso repetir o nome do banco de destino, para não gravar no lugar errado por engano.
 */
const aplicar = process.argv.includes('--aplicar')
const confirmo = process.argv.find((a) => a.startsWith('--confirmo='))?.slice('--confirmo='.length)
const urlAntigo = process.env.OLD_MYSQL_URL
if (!urlAntigo) { console.error('Informe OLD_MYSQL_URL (túnel SSH para o MySQL do sistema antigo).'); process.exit(1) }

const env = parseEnv()
const db = createDb(env)
const fonte = await abrirFonteMysql(urlAntigo)
try {
  const { rows } = await db.knex.raw('select current_database() as nome')
  const banco: string = rows[0].nome
  console.log(`Destino: banco "${banco}".`)
  if (aplicar && confirmo !== banco) { console.error(`Para gravar, repita o nome do banco: --confirmo=${banco}`); process.exitCode = 1 }
  else console.log(formatarRelatorio(await importar(db.knex, fonte, { aplicar })))
} finally {
  await fonte.fechar()
  await db.close()
}
