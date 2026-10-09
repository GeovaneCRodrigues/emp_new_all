import { afterEach, describe, expect, it, vi } from 'vitest'
import { criarAuthHttp } from './auth.http'
import { criarClientesHttp } from './clientes.http'
import { criarRecebimentosHttp } from './recebimentos.http'

// O servidor recusa "Content-Type: application/json" sem corpo. Foi o que fez o logout falhar em silêncio no navegador
// (a sessão ficava aberta no servidor) e o "Desfazer" do recebimento dar erro.
const S = { perfil: 'ADMIN' as const, usuarioId: 1 }

function espiarFetch() {
  const chamadas: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { chamadas.push({ url, init }); return new Response(null, { status: 204 }) })
  return chamadas
}
const cabecalho = (init: RequestInit, nome: string) => new Headers(init.headers as HeadersInit).get(nome)

afterEach(() => vi.unstubAllGlobals())

describe('Content-Type só quando há corpo', () => {
  it('logout (POST sem corpo) não manda Content-Type JSON, mas manda o token', async () => {
    const c = espiarFetch()
    await criarAuthHttp('http://api').logout('TOKEN')
    expect(c[0].url).toBe('http://api/api/auth/logout')
    expect(cabecalho(c[0].init, 'content-type')).toBeNull()
    expect(cabecalho(c[0].init, 'authorization')).toBe('Bearer TOKEN')
  })
  it('login (POST com corpo) manda Content-Type JSON', async () => {
    const c = espiarFetch()
    await criarAuthHttp('http://api').login('a@b.com', 'x').catch(() => undefined)
    expect(cabecalho(c[0].init, 'content-type')).toBe('application/json')
  })
  it('desfazer um recebimento (POST sem corpo) não manda Content-Type JSON', async () => {
    const c = espiarFetch()
    await criarRecebimentosHttp('http://api', (u, i) => fetch(u, i)).desfazer(S, 7)
    expect(c[0].url).toBe('http://api/api/recebimentos/7/desfazer')
    expect(cabecalho(c[0].init, 'content-type')).toBeNull()
  })
  it('registrar um recebimento (com corpo) manda JSON', async () => {
    const c = espiarFetch()
    await criarRecebimentosHttp('http://api', (u, i) => fetch(u, i)).registrar(S, 'VENDA', 1, { parcela: 1, valor: 10, forma: 'PIX' }).catch(() => undefined)
    expect(cabecalho(c[0].init, 'content-type')).toBe('application/json')
    expect(JSON.parse(c[0].init.body as string)).toMatchObject({ parcela: 1, valor: 10, forma: 'PIX' })
  })
  it('GET não manda Content-Type', async () => {
    const c = espiarFetch()
    await criarClientesHttp('http://api', (u, i) => fetch(u, i)).listar(S, {}).catch(() => undefined)
    expect(cabecalho(c[0].init, 'content-type')).toBeNull()
  })
})
