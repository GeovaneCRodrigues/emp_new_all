import type { FastifyInstance } from 'fastify'
import type { Knex } from 'knex'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { createAuditoriaRepository } from '../src/modules/auditoria/models/repository.js'
import { createSessoesRepository, createUsuariosRepository } from '../src/modules/auth/models/repository.js'
import { createAuthService } from '../src/modules/auth/services/auth.service.js'
import { hashSenha } from '../src/modules/auth/services/password.js'
import { createTokensService } from '../src/modules/auth/services/tokens.js'
import { createDocumentosRepository } from '../src/modules/clientes/models/documentos.repository.js'
import { createClientesRepository } from '../src/modules/clientes/models/repository.js'
import { createClientesService } from '../src/modules/clientes/services/clientes.service.js'
import { createDocumentosService, nomeSeguro } from '../src/modules/clientes/services/documentos.service.js'
import { createUsuariosListaRepository } from '../src/modules/usuarios/models/repository.js'
import { createUsuariosService } from '../src/modules/usuarios/services/usuarios.service.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()
const SENHA = 'senha-forte-123'
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF')
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('resto')])
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const corpo = (b: Buffer, o: object = {}) => ({ tipo: 'DOC_IDENTIDADE', nome: 'cnh.pdf', mime: 'application/pdf', dados: b.toString('base64'), ...o })

describe('nomeSeguro', () => {
  it('tira caminho, aspas e controle, e usa a extensão do tipo real', () => {
    expect(nomeSeguro('../../etc/passwd.exe', 'image/png')).toBe('passwd.png')
    expect(nomeSeguro('a"b\r\n.pdf', 'application/pdf')).toBe('ab.pdf')
    expect(nomeSeguro('', 'image/jpeg')).toBe('documento.jpg')
    expect(nomeSeguro(undefined, 'application/pdf')).toBe('documento.pdf')
  })
})

describe.skipIf(!db)('documentos do cliente (Postgres de verdade)', () => {
  let app: FastifyInstance
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}
  const req = (metodo: 'GET' | 'POST' | 'DELETE', url: string, papel?: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  const enviar = (cli: number, papel: string, b: Buffer, o: object = {}) => req('POST', `/api/clientes/${cli}/documentos`, papel, corpo(b, o))

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    const hash = await hashSenha(SENHA)
    const [ind] = await k('indicadores').insert({ nome: 'Roberto', pct: 0.5 }).returning('id')
    const mk = async (chave: string, perfil: string, extra: object = {}) => {
      const [u] = await k('users').insert({ nome: chave, email: `${chave}@t.com`, senha_hash: hash, perfil, ...extra }).returning('id')
      id[chave] = u.id
    }
    await mk('admin', 'ADMIN'); await mk('vendedorA', 'VENDEDOR'); await mk('vendedorB', 'VENDEDOR'); await mk('cobrador', 'COBRADOR'); await mk('indicador', 'INDICADOR', { indicador_id: ind.id })
    const [c1] = await k('clientes').insert({ nome: 'Ana Souza', fone: '11988124410', responsavel_id: id.vendedorA }).returning('id')
    const [c2] = await k('clientes').insert({ nome: 'Bruno Lima', fone: '11977612209', responsavel_id: id.vendedorB }).returning('id')
    id.c1 = c1.id; id.c2 = c2.id
    const tokens = createTokensService('x'.repeat(40), '15m')
    const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
    const aud = createAuditoriaRepository(k)
    const clientesRepo = createClientesRepository(k)
    app = await buildApp({
      env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, clientes: createClientesService(clientesRepo, aud),
      documentosCliente: createDocumentosService(createDocumentosRepository(k), clientesRepo, aud),
      usuarios: createUsuariosService(createUsuariosListaRepository(k)), indicadores: {} as never, estoque: {} as never, vendas: {} as never, config: {} as never, recebimentos: {} as never, aprovacoes: {} as never, fechamentos: {} as never, equipe: {} as never,
    })
    for (const papel of ['admin', 'vendedorA', 'vendedorB', 'cobrador', 'indicador']) {
      t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
    }
  })
  afterAll(async () => { await app?.close(); await db?.destroy() })

  it('envia, lista (sem o conteúdo) e baixa o mesmo arquivo, com hash e auditoria', async () => {
    const r = await enviar(id.c1, 'vendedorA', PDF, { nome: '../CNH frente.pdf' })
    expect(r.statusCode).toBe(201)
    const doc = r.json()
    expect(doc).toMatchObject({ clienteId: id.c1, tipo: 'DOC_IDENTIDADE', nome: 'CNH frente.pdf', mime: 'application/pdf', tamanho: PDF.length, enviadoPor: id.vendedorA })
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/)

    const lista = (await req('GET', `/api/clientes/${id.c1}/documentos`, 'admin')).json().itens
    expect(lista).toHaveLength(1)
    expect(JSON.stringify(lista)).not.toContain('conteudo')

    const a = await req('GET', `/api/clientes/${id.c1}/documentos/${doc.id}/arquivo`, 'admin')
    expect(a.statusCode).toBe(200)
    expect(a.headers['content-type']).toBe('application/pdf')
    expect(a.headers['cache-control']).toBe('no-store')
    expect(a.headers['x-content-type-options']).toBe('nosniff')
    expect(a.rawPayload.equals(PDF)).toBe(true)

    const acoes = (await db!('auditoria').where({ entidade: 'cliente', entidade_id: id.c1 }).pluck('acao')) as string[]
    expect(acoes).toEqual(expect.arrayContaining(['DOCUMENTO_CLIENTE_ENVIADO', 'DOCUMENTO_CLIENTE_VISTO']))
  })

  it('aceita PNG e JPG', async () => {
    expect((await enviar(id.c1, 'admin', PNG, { tipo: 'SELFIE', mime: 'image/png', nome: 'a.png' })).statusCode).toBe(201)
    expect((await enviar(id.c1, 'admin', JPG, { tipo: 'COMPROVANTE_RESIDENCIA', mime: 'image/jpeg', nome: 'b.jpg' })).statusCode).toBe(201)
  })

  it('recusa o que não bate: tipo, mime, conteúdo, base64 e tamanho', async () => {
    expect((await enviar(id.c1, 'admin', PDF, { tipo: 'CARTAO' })).statusCode).toBe(400)
    expect((await enviar(id.c1, 'admin', PDF, { mime: 'text/html' })).statusCode).toBe(400)
    expect((await enviar(id.c1, 'admin', Buffer.from('<script>alert(1)</script>'), { mime: 'application/pdf' })).statusCode).toBe(400) // mime mente
    expect((await enviar(id.c1, 'admin', PNG, { mime: 'image/jpeg' })).statusCode).toBe(400)
    expect((await enviar(id.c1, 'admin', PDF, { dados: 'não é base64!' })).statusCode).toBe(400)
    expect((await enviar(id.c1, 'admin', Buffer.alloc(0))).statusCode).toBe(400)
    const grande = Buffer.concat([PDF, Buffer.alloc(6 * 1024 * 1024)])
    expect((await enviar(id.c1, 'admin', grande)).statusCode).toBe(400)
  })

  it('escopo: vendedor de outra carteira dá 404; indicador e cobrador dão 403', async () => {
    expect((await req('GET', `/api/clientes/${id.c1}/documentos`, 'vendedorB')).statusCode).toBe(404)
    expect((await enviar(id.c1, 'vendedorB', PDF)).statusCode).toBe(404)
    for (const papel of ['indicador', 'cobrador']) {
      expect((await req('GET', `/api/clientes/${id.c1}/documentos`, papel)).statusCode).toBe(403)
      expect((await enviar(id.c1, papel, PDF)).statusCode).toBe(403)
    }
    expect((await req('GET', `/api/clientes/${id.c1}/documentos`)).statusCode).toBe(401)
  })

  it('não baixa nem remove documento de outro cliente pelo id', async () => {
    const outro = (await enviar(id.c2, 'admin', PDF)).json()
    expect((await req('GET', `/api/clientes/${id.c1}/documentos/${outro.id}/arquivo`, 'admin')).statusCode).toBe(404)
    expect((await req('DELETE', `/api/clientes/${id.c1}/documentos/${outro.id}`, 'admin')).statusCode).toBe(404)
    expect((await req('GET', `/api/clientes/${id.c2}/documentos/${outro.id}/arquivo`, 'vendedorA')).statusCode).toBe(404)
  })

  it('remove e registra quem removeu', async () => {
    const d = (await enviar(id.c1, 'vendedorA', PDF, { tipo: 'OUTRO' })).json()
    expect((await req('DELETE', `/api/clientes/${id.c1}/documentos/${d.id}`, 'vendedorA')).statusCode).toBe(204)
    expect((await req('GET', `/api/clientes/${id.c1}/documentos/${d.id}/arquivo`, 'vendedorA')).statusCode).toBe(404)
    expect(await db!('auditoria').where({ acao: 'DOCUMENTO_CLIENTE_REMOVIDO', entidade_id: id.c1 }).first()).toBeTruthy()
  })

  it('limita a 20 documentos por cliente', async () => {
    const [c] = await db!('clientes').insert({ nome: 'Cheio', fone: '11900000001', responsavel_id: id.vendedorA }).returning('id')
    for (let i = 0; i < 20; i++) expect((await enviar(c.id, 'admin', PDF)).statusCode).toBe(201)
    expect((await enviar(c.id, 'admin', PDF)).statusCode).toBe(400)
  })

  it('apagar o cliente leva os documentos junto', async () => {
    const [c] = await db!('clientes').insert({ nome: 'Efêmero', fone: '11900000002' }).returning('id')
    await enviar(c.id, 'admin', PDF)
    await db!('clientes').where({ id: c.id }).del()
    expect(await db!('cliente_documentos').where({ cliente_id: c.id }).first()).toBeUndefined()
  })
})
