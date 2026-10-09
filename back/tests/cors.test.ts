import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'

const ORIGEM = 'http://127.0.0.1:5177'

async function montar() {
  return buildApp({ env: { NODE_ENV: 'test', CORS_ORIGIN: [ORIGEM] }, db: { ping: async () => {} }, tokens: {} as never, auth: {} as never, clientes: {} as never, usuarios: {} as never, indicadores: {} as never, estoque: {} as never, vendas: {} as never, config: {} as never, recebimentos: {} as never, aprovacoes: {} as never, fechamentos: {} as never, equipe: {} as never })
}
const preflight = (app: Awaited<ReturnType<typeof montar>>, origem: string, metodo: string) =>
  app.inject({ method: 'OPTIONS', url: '/api/clientes/1', headers: { origin: origem, 'access-control-request-method': metodo, 'access-control-request-headers': 'authorization,content-type' } })

describe('CORS', () => {
  it.each(['GET', 'POST', 'PATCH', 'DELETE'])('libera %s para a origem do front (senão editar e excluir quebram no navegador)', async (metodo) => {
    const r = await preflight(await montar(), ORIGEM, metodo)
    expect(r.headers['access-control-allow-origin']).toBe(ORIGEM)
    expect(String(r.headers['access-control-allow-methods'])).toContain(metodo)
  })

  it('não libera origem desconhecida', async () => {
    const r = await preflight(await montar(), 'http://site-mal-intencionado.com', 'PATCH')
    expect(r.headers['access-control-allow-origin']).toBeUndefined()
  })
})
