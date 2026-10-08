import type { FastifyInstance } from 'fastify'
import type { Knex } from 'knex'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { createAuditoriaRepository } from '../src/modules/auditoria/models/repository.js'
import { createSessoesRepository, createUsuariosRepository } from '../src/modules/auth/models/repository.js'
import { createAuthService } from '../src/modules/auth/services/auth.service.js'
import { hashSenha } from '../src/modules/auth/services/password.js'
import { createTokensService } from '../src/modules/auth/services/tokens.js'
import { createEstoqueRepository } from '../src/modules/estoque/models/repository.js'
import { createEstoqueService } from '../src/modules/estoque/services/estoque.service.js'
import { imeiValido } from '../src/shared/documentos.js'
import { hojeBR } from '../src/shared/relogio.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()
const SENHA = 'senha-forte-123'

/** Monta um IMEI válido a partir de um número (14 dígitos + dígito verificador de Luhn). */
function imei(n: number): string {
  const base = String(35000000000000 + n)
  let soma = 0
  for (let i = 0; i < 14; i++) {
    let d = Number(base[13 - i])
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9 }
    soma += d
  }
  const r = base + String((10 - (soma % 10)) % 10)
  if (!imeiValido(r)) throw new Error('helper de IMEI quebrado')
  return r
}

describe.skipIf(!db)('estoque (Postgres de verdade)', () => {
  let app: FastifyInstance
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}

  const req = (metodo: 'GET' | 'POST' | 'PATCH', url: string, papel?: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  const aparelho = (extra: object = {}) => ({ modelo: 'iPhone 13', gb: 128, cor: 'Meia-noite', preco: 3600, custo: 2150, extras: 80, bateria: 88, dataCompra: '2026-09-29', ...extra })
  const criar = async (extra: object = {}) => (await req('POST', '/api/aparelhos', 'admin', aparelho(extra))).json()

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    const hash = await hashSenha(SENHA)
    const [ind] = await k('indicadores').insert({ nome: 'Roberto', pct: 0.5 }).returning('id')
    for (const [chave, perfil, extra] of [['admin', 'ADMIN', {}], ['vendedorA', 'VENDEDOR', {}], ['vendedorB', 'VENDEDOR', {}], ['cobrador', 'COBRADOR', {}], ['indicador', 'INDICADOR', { indicador_id: ind.id }]] as const) {
      const [u] = await k('users').insert({ nome: chave, email: `${chave}@t.com`, senha_hash: hash, perfil, ...extra }).returning('id')
      id[chave] = u.id
    }
    const [cA] = await k('clientes').insert({ nome: 'Ana da Carteira A', fone: '11900000001', responsavel_id: id.vendedorA }).returning('id')
    const [cB] = await k('clientes').insert({ nome: 'Bruno da Carteira B', fone: '11900000002', responsavel_id: id.vendedorB }).returning('id')
    id.cA = cA.id; id.cB = cB.id

    const tokens = createTokensService('x'.repeat(40), '15m')
    const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
    const audit = createAuditoriaRepository(k)
    app = await buildApp({
      env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth,
      clientes: {} as never, usuarios: {} as never, indicadores: {} as never, estoque: createEstoqueService(createEstoqueRepository(k), audit), vendas: {} as never, config: {} as never,
    })
    for (const papel of ['admin', 'vendedorA', 'vendedorB', 'cobrador', 'indicador'])
      t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  })

  afterAll(async () => { await app?.close(); await db?.destroy() })

  describe('permissões', () => {
    it('cobrador e indicador não têm acesso ao estoque (403); sem login, 401', async () => {
      for (const papel of ['cobrador', 'indicador']) {
        for (const url of ['/api/aparelhos', '/api/aparelhos/resumo', '/api/aparelhos/1']) expect((await req('GET', url, papel)).statusCode).toBe(403)
      }
      expect((await req('GET', '/api/aparelhos')).statusCode).toBe(401)
    })
    it('vendedor não cadastra nem edita aparelho (403)', async () => {
      expect((await req('POST', '/api/aparelhos', 'vendedorA', aparelho())).statusCode).toBe(403)
      expect((await req('PATCH', '/api/aparelhos/1', 'vendedorA', { preco: 1 })).statusCode).toBe(403)
    })
  })

  describe('cadastro', () => {
    it('admin cadastra: normaliza o texto, grava os valores, e audita', async () => {
      const r = await req('POST', '/api/aparelhos', 'admin', aparelho({ modelo: '  iPhone   13 ', imei: '49-015420-323751-8' }))
      expect(r.statusCode).toBe(201)
      const a = r.json()
      expect(a).toMatchObject({ modelo: 'iPhone 13', gb: 128, cor: 'Meia-noite', bateria: 88, condicao: 'Seminovo', origem: 'COMPRA', estado: 'DISPONIVEL', imei: '490154203237518', custo: 2150, extras: 80, preco: 3600, dataCompra: '2026-09-29', paraCliente: null })
      const aud = await db!('auditoria').where({ acao: 'APARELHO_CRIADO', entidade_id: a.id }).first()
      expect(aud).toMatchObject({ usuario_id: id.admin })
      id.a13 = a.id
    })

    it('usa padrões: seminovo, compra, bateria 100, custo 0, disponível e data de hoje', async () => {
      const r = await req('POST', '/api/aparelhos', 'admin', { modelo: 'iPhone 12', gb: 64, cor: 'Branco', preco: 2400 })
      expect(r.json()).toMatchObject({ condicao: 'Seminovo', origem: 'COMPRA', bateria: 100, custo: 0, extras: 0, estado: 'DISPONIVEL', imei: null })
      expect(r.json().dataCompra).toBe(hojeBR())
    })

    it.each([
      ['sem modelo', { modelo: undefined }], ['modelo curto', { modelo: 'i' }], ['sem GB', { gb: undefined }], ['GB com vírgula', { gb: 12.5 }], ['GB como texto', { gb: '128' }],
      ['sem cor', { cor: undefined }], ['bateria acima de 100', { bateria: 101 }], ['bateria negativa', { bateria: -1 }],
      ['condição inventada', { condicao: 'Quebrado' }], ['origem inventada', { origem: 'ROUBO' }],
      ['sem preço', { preco: undefined }], ['preço zero', { preco: 0 }], ['preço negativo', { preco: -5 }], ['preço como texto', { preco: '3600' }],
      ['custo negativo', { custo: -1 }], ['extras negativos', { extras: -1 }], ['custo absurdo', { custo: 1e12 }],
      ['data inválida', { dataCompra: '2026-02-31' }], ['data em outro formato', { dataCompra: '29/09/2026' }],
      ['observação enorme', { observacoes: 'x'.repeat(501) }],
    ])('recusa %s (400)', async (_n, mudanca) => {
      const corpo = { ...aparelho(), ...mudanca } as Record<string, unknown>
      for (const k of Object.keys(corpo)) if (corpo[k] === undefined) delete corpo[k]
      expect((await req('POST', '/api/aparelhos', 'admin', corpo)).statusCode).toBe(400)
    })
  })

  describe('IMEI', () => {
    it('recusa IMEI com dígito verificador errado ou tamanho errado', async () => {
      for (const i of ['490154203237519', '123456789012345', '49015420323751', 'abc']) expect((await req('POST', '/api/aparelhos', 'admin', aparelho({ imei: i }))).statusCode).toBe(400)
    })
    it('IMEI repetido é 409, com ou sem separadores', async () => {
      for (const i of ['490154203237518', '49-015420-323751-8']) {
        const r = await req('POST', '/api/aparelhos', 'admin', aparelho({ imei: i }))
        expect(r.statusCode).toBe(409)
        expect(r.json().codigo).toBe('IMEI_DUPLICADO')
      }
    })
    it('IMEI é opcional: vários aparelhos sem IMEI convivem', async () => {
      expect((await req('POST', '/api/aparelhos', 'admin', aparelho())).json().imei).toBeNull()
      expect((await req('POST', '/api/aparelhos', 'admin', aparelho())).statusCode).toBe(201)
    })
    it('IMEI antigo (que não passa na validação) não impede de editar o preço, mas trocar por outro inválido é recusado', async () => {
      const [l] = await db!('bens').insert({ modelo: 'iPhone 11', gb: 64, cor: 'Preto', preco_venda: 1800, data_compra: '2026-01-10', imei: '352918114471203' }).returning('id')
      const r = await req('PATCH', `/api/aparelhos/${l.id}`, 'admin', { preco: 1900, imei: '352918114471203', modelo: 'iPhone 11' })
      expect(r.statusCode).toBe(200)
      expect(r.json()).toMatchObject({ preco: 1900, imei: '352918114471203' })
      expect((await req('PATCH', `/api/aparelhos/${l.id}`, 'admin', { imei: '352918114471204' })).statusCode).toBe(400)
    })
    it('editar para o IMEI de outro aparelho é 409; reenviar o próprio IMEI passa', async () => {
      const b = await criar({ imei: imei(1) })
      expect((await req('PATCH', `/api/aparelhos/${b.id}`, 'admin', { imei: '490154203237518' })).statusCode).toBe(409)
      expect((await req('PATCH', `/api/aparelhos/${b.id}`, 'admin', { imei: imei(1) })).statusCode).toBe(200)
      expect((await req('PATCH', `/api/aparelhos/${b.id}`, 'admin', { imei: null })).json().imei).toBeNull()
    })
  })

  describe('estado e encomenda', () => {
    it('encomendado precisa de um cliente que exista', async () => {
      expect((await req('POST', '/api/aparelhos', 'admin', aparelho({ estado: 'ENCOMENDADO' }))).statusCode).toBe(400)
      expect((await req('POST', '/api/aparelhos', 'admin', aparelho({ estado: 'ENCOMENDADO', paraClienteId: 99999 }))).statusCode).toBe(400)
      const r = await req('POST', '/api/aparelhos', 'admin', aparelho({ estado: 'ENCOMENDADO', paraClienteId: id.cA }))
      expect(r.statusCode).toBe(201)
      expect(r.json()).toMatchObject({ estado: 'ENCOMENDADO', paraCliente: { id: id.cA, nome: 'Ana da Carteira A' } })
    })
    it('disponível não tem cliente, e "vendido" não se escolhe', async () => {
      expect((await req('POST', '/api/aparelhos', 'admin', aparelho({ paraClienteId: id.cA }))).statusCode).toBe(400)
      expect((await req('POST', '/api/aparelhos', 'admin', aparelho({ estado: 'VENDIDO' }))).statusCode).toBe(400)
      expect((await req('POST', '/api/aparelhos', 'admin', aparelho({ estado: 'OUTRO' }))).statusCode).toBe(400)
    })
    it('alterna entre disponível e encomendado, limpando o cliente ao voltar', async () => {
      const a = await criar()
      const enc = await req('PATCH', `/api/aparelhos/${a.id}`, 'admin', { estado: 'ENCOMENDADO', paraClienteId: id.cB })
      expect(enc.json()).toMatchObject({ estado: 'ENCOMENDADO', paraCliente: { id: id.cB } })
      const volta = await req('PATCH', `/api/aparelhos/${a.id}`, 'admin', { estado: 'DISPONIVEL' })
      expect(volta.json()).toMatchObject({ estado: 'DISPONIVEL', paraCliente: null })
    })
    it('não dá para marcar como vendido pela edição', async () => {
      const a = await criar()
      expect((await req('PATCH', `/api/aparelhos/${a.id}`, 'admin', { estado: 'VENDIDO' })).statusCode).toBe(400)
    })
    it('aparelho vendido é somente leitura (409)', async () => {
      const [v] = await db!('bens').insert({ modelo: 'iPhone 14', gb: 128, cor: 'Azul', preco_venda: 4600, data_compra: '2026-07-01', estado: 'VENDIDO', valor_compra: 2900 }).returning('id')
      id.vendido = v.id
      const r = await req('PATCH', `/api/aparelhos/${v.id}`, 'admin', { preco: 1 })
      expect(r.statusCode).toBe(409)
      expect(r.json().codigo).toBe('APARELHO_VENDIDO')
    })
  })

  describe('edição', () => {
    it('muda só o que veio e audita o antes e o depois do custo e do preço', async () => {
      const a = await criar({ custo: 1000, preco: 2000 })
      const r = await req('PATCH', `/api/aparelhos/${a.id}`, 'admin', { custo: 1100, preco: 2200 })
      expect(r.json()).toMatchObject({ modelo: 'iPhone 13', custo: 1100, extras: 80, preco: 2200 })
      const aud = await db!('auditoria').where({ acao: 'APARELHO_ALTERADO', entidade_id: a.id }).first()
      expect(aud.antes).toMatchObject({ custo: 1000, preco: 2000 })
      expect(aud.depois).toMatchObject({ custo: 1100, preco: 2200 })
    })
    it('validações valem na edição também; id inexistente é 404; id inválido é 400', async () => {
      const a = await criar()
      expect((await req('PATCH', `/api/aparelhos/${a.id}`, 'admin', { preco: 0 })).statusCode).toBe(400)
      expect((await req('PATCH', `/api/aparelhos/${a.id}`, 'admin', { bateria: 500 })).statusCode).toBe(400)
      expect((await req('PATCH', '/api/aparelhos/99999', 'admin', { preco: 10 })).statusCode).toBe(404)
      expect((await req('GET', '/api/aparelhos/abc', 'admin')).statusCode).toBe(400)
    })
  })

  describe('lista e busca', () => {
    it('admin vê todos os estados, com custo e extras', async () => {
      const r = (await req('GET', '/api/aparelhos?limite=100', 'admin')).json()
      expect(new Set(r.itens.map((a: { estado: string }) => a.estado))).toEqual(new Set(['DISPONIVEL', 'ENCOMENDADO', 'VENDIDO']))
      expect(r.itens.every((a: Record<string, unknown>) => 'custo' in a && 'extras' in a)).toBe(true)
    })
    it('filtra por estado e recusa estado inventado', async () => {
      const r = (await req('GET', '/api/aparelhos?estado=VENDIDO', 'admin')).json()
      expect(r.itens.every((a: { estado: string }) => a.estado === 'VENDIDO')).toBe(true)
      expect((await req('GET', '/api/aparelhos?estado=XYZ', 'admin')).statusCode).toBe(400)
    })
    it('busca por modelo, cor e parte do IMEI, sem diferenciar maiúscula', async () => {
      const nomes = async (q: string) => ((await req('GET', `/api/aparelhos?busca=${encodeURIComponent(q)}&limite=100`, 'admin')).json().itens as { modelo: string }[]).map((a) => a.modelo)
      expect(await nomes('IPHONE 14')).toEqual(['iPhone 14'])
      expect((await nomes('branco')).every((m) => m === 'iPhone 12')).toBe(true)
      expect((await nomes('4902-15')).length).toBe(0) // a busca de IMEI usa só dígitos
      expect((await nomes('0154203')).length).toBeGreaterThan(0)
    })
    it('"%" e "_" são texto, não curinga', async () => {
      expect((await req('GET', `/api/aparelhos?busca=${encodeURIComponent('%')}`, 'admin')).json().total).toBe(0)
      expect((await req('GET', '/api/aparelhos?busca=_', 'admin')).json().total).toBe(0)
    })
    it('pagina, informa o total e corta o limite em 100; mais novas primeiro', async () => {
      const p1 = (await req('GET', '/api/aparelhos?limite=2&pagina=1', 'admin')).json()
      const p2 = (await req('GET', '/api/aparelhos?limite=2&pagina=2', 'admin')).json()
      expect(p1.itens).toHaveLength(2)
      expect(p1.total).toBeGreaterThan(2)
      expect(p2.itens[0].id).not.toBe(p1.itens[0].id)
      expect((await req('GET', '/api/aparelhos?limite=99999', 'admin')).json().limite).toBe(100)
      const datas = (await req('GET', '/api/aparelhos?limite=100', 'admin')).json().itens.map((a: { dataCompra: string }) => a.dataCompra)
      expect(datas).toEqual([...datas].sort().reverse())
    })
  })

  describe('vendedor: nunca vê custo', () => {
    it('lista, ficha e resumo não trazem custo, extras nem observações (os campos nem existem)', async () => {
      await req('PATCH', `/api/aparelhos/${id.a13}`, 'admin', { observacoes: 'comprado do fornecedor X por 2150' })
      for (const url of ['/api/aparelhos?limite=100', `/api/aparelhos/${id.a13}`, '/api/aparelhos/resumo']) {
        const r = await req('GET', url, 'vendedorA')
        expect(r.statusCode).toBe(200)
        expect(r.body).not.toMatch(/custo|extras|observacoes|capitalParado|margem|2150|fornecedor/i)
      }
    })
    it('vê o preço de venda e só o que está à venda (sem vendidos)', async () => {
      const r = (await req('GET', '/api/aparelhos?limite=100', 'vendedorA')).json()
      expect(r.itens.length).toBeGreaterThan(0)
      expect(r.itens.every((a: { preco: number; estado: string }) => a.preco > 0 && a.estado !== 'VENDIDO')).toBe(true)
      expect((await req('GET', '/api/aparelhos?estado=VENDIDO', 'vendedorA')).json().total).toBe(0)
      expect((await req('GET', `/api/aparelhos/${id.vendido}`, 'vendedorA')).statusCode).toBe(404)
    })
    it('só vê quem encomendou se o cliente é da carteira dele', async () => {
      const a = await criar({ estado: 'ENCOMENDADO', paraClienteId: id.cA })
      const doA = (await req('GET', `/api/aparelhos/${a.id}`, 'vendedorA')).json()
      const doB = (await req('GET', `/api/aparelhos/${a.id}`, 'vendedorB')).json()
      expect(doA.paraCliente).toMatchObject({ nome: 'Ana da Carteira A' })
      expect(doB.estado).toBe('ENCOMENDADO')
      expect(doB.paraCliente).toBeNull()
      expect((await req('GET', '/api/aparelhos?limite=100', 'vendedorB')).body).not.toContain('Ana da Carteira A')
    })
  })

  describe('resumo', () => {
    it('admin recebe capital parado e margem; vendedor só contagens e valor em vitrine', async () => {
      const esperado = await db!('bens').where({ estado: 'DISPONIVEL' }).select(db!.raw('count(*) as n, sum(valor_compra + custos_extras) as capital, sum(preco_venda) as vitrine')).first<{ n: string; capital: string; vitrine: string }>()
      const adm = (await req('GET', '/api/aparelhos/resumo', 'admin')).json()
      expect(adm.disponiveis).toBe(Number(esperado.n))
      expect(adm.capitalParado).toBeCloseTo(Number(esperado.capital), 2)
      expect(adm.valorEmVitrine).toBeCloseTo(Number(esperado.vitrine), 2)
      expect(adm.margemMedia).toBeGreaterThan(0)
      const vend = (await req('GET', '/api/aparelhos/resumo', 'vendedorA')).json()
      expect(Object.keys(vend).sort()).toEqual(['disponiveis', 'encomendados', 'valorEmVitrine'])
      expect(vend.disponiveis).toBe(adm.disponiveis)
    })
  })
})
