import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { createAuthService } from '../src/modules/auth/services/auth.service.js'
import { createTokensService } from '../src/modules/auth/services/tokens.js'
import { lerJsonSeguro } from '../src/shared/json.js'
import { sessoesEmMemoria, usuariosEmMemoria } from './helpers/fakes.js'

let app: FastifyInstance
async function montar(limites?: { geralPorMinuto?: number }) {
  const tokens = createTokensService('x'.repeat(40), '15m')
  const auth = createAuthService(usuariosEmMemoria(), sessoesEmMemoria(), tokens)
  app = await buildApp({ env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, clientes: {} as never, usuarios: {} as never, indicadores: {} as never, estoque: {} as never, vendas: {} as never, config: {} as never, recebimentos: {} as never, aprovacoes: {} as never, fechamentos: {} as never, equipe: {} as never, limites })
}
afterEach(async () => { await app.close() })

const tentarLogin = (ip: string) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ninguem@loja.com', senha: 'errada-errada' }, headers: { 'x-forwarded-for': ip } })

describe('limite de tentativas de login (por IP real, atrás do nginx)', () => {
  it('quem erra 10 vezes é barrado, e outro IP continua entrando', async () => {
    await montar()
    for (let i = 0; i < 10; i++) expect((await tentarLogin('203.0.113.7')).statusCode).toBe(401)
    expect((await tentarLogin('203.0.113.7')).statusCode).toBe(429)
    expect((await tentarLogin('198.51.100.9')).statusCode).toBe(401)
  })
})

describe('limite geral de requisições', () => {
  it('passado o limite do IP, responde 429; o health check nunca é limitado', async () => {
    await montar({ geralPorMinuto: 3 })
    const eu = () => app.inject({ method: 'GET', url: '/api/auth/eu', headers: { 'x-forwarded-for': '203.0.113.7' } })
    for (let i = 0; i < 3; i++) expect((await eu()).statusCode).toBe(401)
    expect((await eu()).statusCode).toBe(429)
    for (let i = 0; i < 6; i++) expect((await app.inject({ method: 'GET', url: '/health', headers: { 'x-forwarded-for': '203.0.113.7' } })).statusCode).toBe(200)
  })
})

describe('corpo da requisição', () => {
  it('acima de 1 MB é recusado (413)', async () => {
    await montar()
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@b.com', senha: 'x'.repeat(1_100_000) } })
    expect(r.statusCode).toBe(413)
  })
  it('"__proto__" no JSON é descartado e não muda o protótipo de quem copiar o corpo', () => {
    const corpo = lerJsonSeguro('{"nome":"A","__proto__":{"admin":true},"aninhado":{"__proto__":{"x":1}}}') as Record<string, unknown>
    expect(Object.keys(corpo)).toEqual(['nome', 'aninhado'])
    const copia = Object.assign({}, corpo) as { admin?: boolean }
    expect(copia.admin).toBeUndefined()
    expect(({} as { admin?: boolean }).admin).toBeUndefined()
    expect(() => lerJsonSeguro('{quebrado')).toThrow()
  })
})
