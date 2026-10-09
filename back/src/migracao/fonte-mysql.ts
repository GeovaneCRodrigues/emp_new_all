import mysql from 'mysql2/promise'
import type { ClienteAntigo, FonteAntiga, IndicadorAntigo } from './tipos.js'

/**
 * Lê o MySQL do sistema antigo. SÓ LEITURA: a sessão é aberta como READ ONLY e só há SELECT aqui.
 * A URL vem de OLD_MYSQL_URL (ex.: mysql://usuario:senha@127.0.0.1:3307/emp, por um túnel SSH); nunca fica em arquivo.
 */
export async function abrirFonteMysql(url: string): Promise<FonteAntiga & { fechar(): Promise<void> }> {
  const con = await mysql.createConnection({ uri: url, dateStrings: false, decimalNumbers: false })
  await con.query('SET SESSION TRANSACTION READ ONLY')
  const ler = async <T>(sql: string): Promise<T[]> => (await con.query(sql))[0] as T[]

  return {
    async indicadores() {
      const base = await ler<Omit<IndicadorAntigo, 'percentuais'>>('SELECT id, nome, telefone, email, status FROM indicadores ORDER BY id')
      const pcts = await ler<{ indicador_id: number; pct: string; qtd: number | string }>(
        'SELECT indicador_id, percentual_parceiro AS pct, COUNT(*) AS qtd FROM operacoes WHERE indicador_id IS NOT NULL GROUP BY indicador_id, percentual_parceiro',
      )
      return base.map((i) => ({ ...i, percentuais: pcts.filter((p) => p.indicador_id === i.id).map((p) => ({ pct: Number(p.pct), qtd: Number(p.qtd) })) }))
    },
    async clientes() {
      return ler<ClienteAntigo>(
        `SELECT id, nome, cpf_cnpj, rg, telefone1, telefone2, email, endereco, numero, complemento, bairro, cidade, uf, cep,
                indicador_id, status, obs, created_at FROM clientes ORDER BY id`,
      )
    },
    async fechar() { await con.end() },
  }
}
