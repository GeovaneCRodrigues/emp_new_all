import { describe, expect, it, vi } from 'vitest'

// Garantia de que o leitor do sistema antigo NUNCA escreve: tudo o que ele manda ao MySQL é SELECT (ou o SET que liga o modo somente leitura).
const enviadas: string[] = []
vi.mock('mysql2/promise', () => ({
  default: {
    createConnection: async () => ({
      query: async (sql: string) => { enviadas.push(sql.trim()); return [[], []] },
      end: async () => undefined,
    }),
  },
}))

const PROIBIDAS = /\b(insert|update|delete|drop|alter|create|truncate|replace|grant|revoke|rename|lock|call|load|set\s+global)\b/i

describe('o leitor do sistema antigo é somente leitura', () => {
  it('abre a sessão como READ ONLY ANTES de qualquer consulta', async () => {
    enviadas.length = 0
    const { abrirFonteMysql } = await import('../src/migracao/fonte-mysql.js')
    const f = await abrirFonteMysql('mysql://x:y@127.0.0.1:3307/emp')
    expect(enviadas[0]).toBe('SET SESSION TRANSACTION READ ONLY')
    await f.fechar()
  })

  it('só emite SELECT (e o SET de somente leitura): nada de INSERT, UPDATE, DELETE, DDL', async () => {
    enviadas.length = 0
    const { abrirFonteMysql } = await import('../src/migracao/fonte-mysql.js')
    const f = await abrirFonteMysql('mysql://x:y@127.0.0.1:3307/emp')
    await f.indicadores(); await f.clientes()
    await f.fechar()
    expect(enviadas.length).toBeGreaterThanOrEqual(4)
    for (const sql of enviadas.slice(1)) {
      expect(sql, sql).toMatch(/^select\b/i)
      expect(sql, sql).not.toMatch(PROIBIDAS)
    }
    expect(enviadas[0]).toMatch(/^set session transaction read only$/i)
  })

  it('o código-fonte do leitor não tem nenhuma instrução de escrita', async () => {
    const { readFileSync } = await import('node:fs')
    const fonte = readFileSync(new URL('../src/migracao/fonte-mysql.ts', import.meta.url), 'utf8')
    const sqls = [...fonte.matchAll(/(?:ler<[^>]*>|query)\(\s*[`'"]([^`'"]+)/g)].map((m) => m[1].trim())
    expect(sqls.length).toBeGreaterThanOrEqual(3)
    for (const sql of sqls) expect(sql, sql).toMatch(/^(select|set session transaction read only)/i)
  })

  it('o importador só usa o banco NOVO para escrever (o antigo só entra pela fonte)', async () => {
    const { readFileSync } = await import('node:fs')
    const importar = readFileSync(new URL('../src/migracao/importar.ts', import.meta.url), 'utf8')
    expect(importar).not.toMatch(/mysql/i)
  })
})
