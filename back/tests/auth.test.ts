import type { FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { createAuthService } from '../src/modules/auth/services/auth.service.js'
import { hashSenha } from '../src/modules/auth/services/password.js'
import { createTokensService } from '../src/modules/auth/services/tokens.js'
import { sessoesEmMemoria, usuariosEmMemoria } from './helpers/fakes.js'

const SEGREDO = 'x'.repeat(40)
const SENHA = 'senha-forte-123'

let app: FastifyInstance
let users: ReturnType<typeof usuariosEmMemoria>
let sessoes: ReturnType<typeof sessoesEmMemoria>
let relogio: number

async function montar() {
  users = usuariosEmMemoria()
  sessoes = sessoesEmMemoria()
  relogio = Date.now()
  await users.criar({ nome: 'Geovane', email: 'geovane@loja.com', senhaHash: await hashSenha(SENHA), perfil: 'ADMIN', indicadorId: null, ativo: true })
  const tokens = createTokensService(SEGREDO, '15m')
  const auth = createAuthService(users, sessoes, tokens, { agora: () => new Date(relogio) })
  app = await buildApp({ env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, clientes: {} as never, usuarios: {} as never, indicadores: {} as never })
}

const post = (url: string, payload?: unknown, token?: string) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} })
const get = (url: string, token?: string) => app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} })
const login = async (senha = SENHA) => post('/api/auth/login', { email: 'geovane@loja.com', senha })
const entrar = async () => (await login()).json() as { accessToken: string; refreshToken: string; usuario: Record<string, unknown> }

beforeEach(montar)

describe('login', () => {
  it('entra com e-mail e senha corretos (e-mail sem diferenciar maiúscula)', async () => {
    const r = await post('/api/auth/login', { email: 'GEOVANE@loja.com', senha: SENHA })
    expect(r.statusCode).toBe(200)
    const b = r.json()
    expect(b.accessToken).toBeTruthy()
    expect(b.refreshToken).toContain('.')
    expect(b.usuario).toMatchObject({ nome: 'Geovane', perfil: 'ADMIN' })
  })

  it('nunca devolve o hash da senha', async () => {
    const txt = (await login()).body
    expect(txt).not.toContain('senhaHash')
    expect(txt).not.toContain('argon2')
  })

  it('senha errada e e-mail inexistente dão a mesma resposta (não revela quem tem conta)', async () => {
    const a = await login('errada-errada')
    const b = await post('/api/auth/login', { email: 'ninguem@loja.com', senha: SENHA })
    expect(a.statusCode).toBe(401)
    expect(b.statusCode).toBe(401)
    expect(a.json()).toEqual(b.json())
  })

  it('pede e-mail e senha', async () => {
    expect((await post('/api/auth/login', { email: 'a@b.c' })).statusCode).toBe(400)
    expect((await post('/api/auth/login')).statusCode).toBe(400)
  })

  it('conta desativada não entra', async () => {
    users.todos[0].ativo = false
    expect((await login()).statusCode).toBe(401)
  })

  it('guarda só o hash do refresh token', async () => {
    const { refreshToken } = await entrar()
    const segredo = refreshToken.split('.')[1]
    expect(sessoes.todas[0].refreshHash).not.toContain(segredo)
    expect(sessoes.todas[0].refreshHash).toHaveLength(64)
  })
})

describe('trava por excesso de tentativas', () => {
  it('trava a conta na 5ª falha, mesmo com a senha certa depois', async () => {
    for (let i = 0; i < 5; i++) expect((await login('errada-errada')).statusCode).toBe(401)
    const r = await login()
    expect(r.statusCode).toBe(423)
    expect(r.json().codigo).toBe('CONTA_BLOQUEADA')
  })

  it('destrava depois do prazo', async () => {
    for (let i = 0; i < 5; i++) await login('errada-errada')
    relogio += 16 * 60_000
    expect((await login()).statusCode).toBe(200)
  })

  it('acerto zera a contagem', async () => {
    for (let i = 0; i < 4; i++) await login('errada-errada')
    expect((await login()).statusCode).toBe(200)
    expect(users.todos[0].falhasLogin).toBe(0)
    for (let i = 0; i < 4; i++) await login('errada-errada')
    expect((await login()).statusCode).toBe(200)
  })
})

describe('sessão e token de acesso', () => {
  it('sem token, 401', async () => {
    expect((await get('/api/auth/eu')).statusCode).toBe(401)
  })

  it('com token válido devolve o usuário', async () => {
    const { accessToken } = await entrar()
    const r = await get('/api/auth/eu', accessToken)
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ email: 'geovane@loja.com', perfil: 'ADMIN' })
  })

  it('token adulterado ou de outro segredo é recusado', async () => {
    const { accessToken } = await entrar()
    expect((await get('/api/auth/eu', accessToken.slice(0, -3) + 'abc')).statusCode).toBe(401)
    const outro = createTokensService('y'.repeat(40), '15m').emitirAcesso({ sessaoId: sessoes.todas[0].id, usuarioId: 1, perfil: 'ADMIN', indicadorId: null })
    expect((await get('/api/auth/eu', outro)).statusCode).toBe(401)
  })

  it('usar o refresh token como token de acesso não funciona', async () => {
    const { refreshToken } = await entrar()
    expect((await get('/api/auth/eu', refreshToken)).statusCode).toBe(401)
  })

  it('conta desativada depois do login perde o acesso na hora', async () => {
    const { accessToken } = await entrar()
    users.todos[0].ativo = false
    expect((await get('/api/auth/eu', accessToken)).statusCode).toBe(401)
  })

  it('mudança de perfil vale na hora: o perfil vem do banco, não do token', async () => {
    const { accessToken } = await entrar()
    users.todos[0].perfil = 'VENDEDOR'
    expect((await get('/api/auth/eu', accessToken)).statusCode).toBe(401)
  })
})

describe('logout', () => {
  it('derruba o token de acesso na hora e o refresh token também', async () => {
    const { accessToken, refreshToken } = await entrar()
    expect((await post('/api/auth/logout', undefined, accessToken)).statusCode).toBe(204)
    expect((await get('/api/auth/eu', accessToken)).statusCode).toBe(401)
    expect((await post('/api/auth/renovar', { refreshToken })).statusCode).toBe(401)
  })

  it('só encerra a sessão deste aparelho', async () => {
    const a = await entrar()
    const b = await entrar()
    await post('/api/auth/logout', undefined, a.accessToken)
    expect((await get('/api/auth/eu', b.accessToken)).statusCode).toBe(200)
  })

  it('logout exige estar logado', async () => {
    expect((await post('/api/auth/logout')).statusCode).toBe(401)
  })

  it('"sair de todos os aparelhos" derruba todas as sessões', async () => {
    const a = await entrar()
    const b = await entrar()
    expect((await post('/api/auth/logout-todas', undefined, a.accessToken)).statusCode).toBe(204)
    expect((await get('/api/auth/eu', a.accessToken)).statusCode).toBe(401)
    expect((await get('/api/auth/eu', b.accessToken)).statusCode).toBe(401)
  })

  it('lista as sessões ativas, marcando a atual', async () => {
    const a = await entrar()
    await entrar()
    const lista = (await get('/api/auth/sessoes', a.accessToken)).json() as { atual: boolean }[]
    expect(lista).toHaveLength(2)
    expect(lista.filter((s) => s.atual)).toHaveLength(1)
  })
})

describe('renovar sessão (refresh token)', () => {
  it('troca por um novo par e o refresh token muda', async () => {
    const a = await entrar()
    const r = await post('/api/auth/renovar', { refreshToken: a.refreshToken })
    expect(r.statusCode).toBe(200)
    const b = r.json()
    expect(b.refreshToken).not.toBe(a.refreshToken)
    expect((await get('/api/auth/eu', b.accessToken)).statusCode).toBe(200)
  })

  it('o refresh token antigo reapresentado derruba a sessão inteira (roubo)', async () => {
    const a = await entrar()
    const b = (await post('/api/auth/renovar', { refreshToken: a.refreshToken })).json()
    expect((await post('/api/auth/renovar', { refreshToken: a.refreshToken })).statusCode).toBe(401)
    // o ladrão usou o antigo: o token novo também deixa de valer
    expect((await post('/api/auth/renovar', { refreshToken: b.refreshToken })).statusCode).toBe(401)
    expect((await get('/api/auth/eu', b.accessToken)).statusCode).toBe(401)
  })

  it('refresh token expirado é recusado', async () => {
    const a = await entrar()
    relogio += 8 * 24 * 3600_000
    expect((await post('/api/auth/renovar', { refreshToken: a.refreshToken })).statusCode).toBe(401)
  })

  it('lixo e tokens de formato errado são recusados sem estourar', async () => {
    for (const t of ['lixo', '.', 'a.b', `${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}.${'z'.repeat(30)}`])
      expect((await post('/api/auth/renovar', { refreshToken: t })).statusCode).toBe(401)
    expect((await post('/api/auth/renovar', {})).statusCode).toBe(400)
  })

  it('conta desativada não renova', async () => {
    const a = await entrar()
    users.todos[0].ativo = false
    expect((await post('/api/auth/renovar', { refreshToken: a.refreshToken })).statusCode).toBe(401)
  })
})

describe('trocar senha', () => {
  const trocar = (token: string, senhaAtual: string, novaSenha: string) => post('/api/auth/senha', { senhaAtual, novaSenha }, token)

  it('troca, mantém esta sessão e derruba as outras', async () => {
    const a = await entrar()
    const b = await entrar()
    expect((await trocar(a.accessToken, SENHA, 'outra-senha-forte')).statusCode).toBe(204)
    expect((await get('/api/auth/eu', a.accessToken)).statusCode).toBe(200)
    expect((await get('/api/auth/eu', b.accessToken)).statusCode).toBe(401)
    expect((await login()).statusCode).toBe(401)
    expect((await login('outra-senha-forte')).statusCode).toBe(200)
  })

  it('exige a senha atual certa', async () => {
    const a = await entrar()
    expect((await trocar(a.accessToken, 'errada-errada', 'outra-senha-forte')).statusCode).toBe(401)
  })

  it('recusa senha curta e senha igual à atual', async () => {
    const a = await entrar()
    expect((await trocar(a.accessToken, SENHA, 'curta')).statusCode).toBe(400)
    expect((await trocar(a.accessToken, SENHA, SENHA)).statusCode).toBe(400)
  })
})

describe('health', () => {
  it('responde ok quando o banco responde', async () => {
    expect((await get('/health')).json()).toEqual({ status: 'ok' })
  })
})
