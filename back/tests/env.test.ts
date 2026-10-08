import { describe, expect, it } from 'vitest'
import { parseEnv } from '../src/config/env.js'

const base = { DATABASE_URL: 'postgres://u:p@h/db', JWT_SECRET: 'x'.repeat(32) }

describe('parseEnv', () => {
  it('aceita o mínimo e preenche os padrões', () => {
    const e = parseEnv(base)
    expect(e).toMatchObject({ NODE_ENV: 'development', PORT: 3000, JWT_EXPIRES_IN: '15m', REFRESH_TTL_DIAS: 7 })
  })
  it('recusa JWT_SECRET ausente ou curto: nunca sobe com segredo fraco', () => {
    expect(() => parseEnv({ ...base, JWT_SECRET: '' })).toThrow(/JWT_SECRET/)
    expect(() => parseEnv({ ...base, JWT_SECRET: 'curto' })).toThrow(/JWT_SECRET/)
  })
  it('exige DATABASE_URL e valida números', () => {
    expect(() => parseEnv({ JWT_SECRET: base.JWT_SECRET })).toThrow(/DATABASE_URL/)
    expect(() => parseEnv({ ...base, PORT: 'abc' })).toThrow(/PORT/)
  })
  it('separa as origens do CORS', () => {
    expect(parseEnv({ ...base, CORS_ORIGIN: 'http://a.com, http://b.com' }).CORS_ORIGIN).toEqual(['http://a.com', 'http://b.com'])
  })
})
