import type { FastifyInstance } from 'fastify'
import type { Knex } from 'knex'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { createAuditoriaRepository } from '../src/modules/auditoria/models/repository.js'
import { createSessoesRepository, createUsuariosRepository } from '../src/modules/auth/models/repository.js'
import { createAuthService } from '../src/modules/auth/services/auth.service.js'
import { hashSenha } from '../src/modules/auth/services/password.js'
import { createTokensService } from '../src/modules/auth/services/tokens.js'
import { createClientesRepository } from '../src/modules/clientes/models/repository.js'
import { createClientesService } from '../src/modules/clientes/services/clientes.service.js'
import { createUsuariosListaRepository } from '../src/modules/usuarios/models/repository.js'
import { createUsuariosService } from '../src/modules/usuarios/services/usuarios.service.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()
const SENHA = 'senha-forte-123'
// CPFs válidos
const CPF_A = '529.982.247-25'
const CPF_B = '111.444.777-35'

describe.skipIf(!db)('clientes (Postgres de verdade)', () => {
  let app: FastifyInstance
  const t: Record<string, string> = {} // tokens por papel
  const id: Record<string, number> = {} // ids de usuários e clientes

  const req = (metodo: 'GET' | 'POST' | 'PATCH', url: string, papel?: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  const nomes = async (papel: string, query = '') => ((await req('GET', `/api/clientes${query}`, papel)).json().itens as { nome: string }[]).map((c) => c.nome).sort()

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    const hash = await hashSenha(SENHA)

    const [ind1, ind2] = await k('indicadores').insert([{ nome: 'Roberto', pct: 0.5 }, { nome: 'Ponto Cell', pct: 0.3 }]).returning('id')
    const mk = async (chave: string, perfil: string, extra: object = {}) => {
      const [u] = await k('users').insert({ nome: chave, email: `${chave}@t.com`, senha_hash: hash, perfil, ...extra }).returning('id')
      id[chave] = u.id
    }
    await mk('admin', 'ADMIN')
    await mk('vendedorA', 'VENDEDOR')
    await mk('vendedorB', 'VENDEDOR')
    await mk('cobrador', 'COBRADOR')
    await mk('indicador1', 'INDICADOR', { indicador_id: ind1.id })
    await mk('indicador2', 'INDICADOR', { indicador_id: ind2.id })

    const cli = async (chave: string, nome: string, fone: string, resp: number | null, cpf: string | null = null) => {
      const [c] = await k('clientes').insert({ nome, fone, cpf, responsavel_id: resp }).returning('id')
      id[chave] = c.id
    }
    await cli('c1', 'Ana Souza', '11988124410', id.vendedorA, '39053344705')
    await cli('c2', 'Bruno Lima', '11977612209', id.vendedorB)
    await cli('c3', 'Carla Dias', '11991027744', id.cobrador)
    await cli('c4', 'Diego Prado 100%', '11984501132', null)

    // c1 foi indicada pelo indicador 1 (venda); c3 pelo indicador 1 (empréstimo); c2 pelo indicador 2
    const [bem] = await k('bens').insert({ modelo: 'iPhone 13', gb: 128, cor: 'Preto', preco_venda: 3600, data_compra: '2026-09-01' }).returning('id')
    const venda = (cliente: number, ind: number) => ({ bem_id: bem.id, cliente_id: cliente, indicador_id: ind, percentual_indicador: 0.5, data_venda: '2026-10-01', valor_investido: 2000, valor_total: 3600 })
    await k('vendas').insert(venda(id.c1, ind1.id))
    await k('bens').insert({ modelo: 'iPhone 14', gb: 128, cor: 'Azul', preco_venda: 4600, data_compra: '2026-09-01' })
    await k('emprestimos').insert({ cliente_id: id.c3, indicador_id: ind1.id, data_emprestimo: '2026-10-01', capital: 1000, modalidade: 'PARCELADO', taxa: 10 })
    await k('emprestimos').insert({ cliente_id: id.c2, indicador_id: ind2.id, data_emprestimo: '2026-10-01', capital: 500, modalidade: 'DIARIA', taxa: 20 })

    const tokens = createTokensService('x'.repeat(40), '15m')
    const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
    const clientes = createClientesService(createClientesRepository(k), createAuditoriaRepository(k))
    app = await buildApp({ env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, clientes, usuarios: createUsuariosService(createUsuariosListaRepository(k)), indicadores: {} as never, estoque: {} as never, vendas: {} as never, config: {} as never, recebimentos: {} as never })
    for (const papel of ['admin', 'vendedorA', 'vendedorB', 'cobrador', 'indicador1', 'indicador2']) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })
      t[papel] = r.json().accessToken
    }
  })

  afterAll(async () => { await app?.close(); await db?.destroy() })

  describe('escopo por perfil', () => {
    it('admin vê todos', async () => expect(await nomes('admin')).toEqual(['Ana Souza', 'Bruno Lima', 'Carla Dias', 'Diego Prado 100%']))
    it('vendedor vê só a própria carteira', async () => {
      expect(await nomes('vendedorA')).toEqual(['Ana Souza'])
      expect(await nomes('vendedorB')).toEqual(['Bruno Lima'])
    })
    it('cobrador vê só a carteira dele', async () => expect(await nomes('cobrador')).toEqual(['Carla Dias']))
    it('indicador vê só quem ele indicou (venda ou empréstimo)', async () => {
      expect(await nomes('indicador1')).toEqual(['Ana Souza', 'Carla Dias'])
      expect(await nomes('indicador2')).toEqual(['Bruno Lima'])
    })
    it('cliente de outra carteira dá 404 (não revela que existe)', async () => {
      expect((await req('GET', `/api/clientes/${id.c2}`, 'vendedorA')).statusCode).toBe(404)
      expect((await req('GET', `/api/clientes/${id.c2}`, 'indicador1')).statusCode).toBe(404)
      expect((await req('GET', `/api/clientes/${id.c1}`, 'cobrador')).statusCode).toBe(404)
      expect((await req('GET', `/api/clientes/${id.c4}`, 'vendedorA')).statusCode).toBe(404)
    })
    it('o indicador não recebe CPF, RG nem endereço', async () => {
      const r = await req('GET', `/api/clientes/${id.c1}`, 'indicador1')
      expect(r.statusCode).toBe(200)
      expect(Object.keys(r.json()).sort()).toEqual(['desde', 'fone', 'id', 'nome'])
      expect(JSON.stringify((await req('GET', '/api/clientes', 'indicador1')).json())).not.toContain('39053344705')
    })
    it('quem tem o escopo recebe os dados completos', async () => {
      expect(await req('GET', `/api/clientes/${id.c1}`, 'vendedorA').then((r) => r.json())).toMatchObject({ nome: 'Ana Souza', cpf: '39053344705' })
    })
    it('sem login, 401', async () => expect((await req('GET', '/api/clientes')).statusCode).toBe(401))
  })

  describe('lista de responsáveis (para o formulário)', () => {
    it('admin vê os usuários que podem ter carteira, sem indicadores e sem dados sensíveis', async () => {
      const r = await req('GET', '/api/usuarios/responsaveis', 'admin')
      expect(r.statusCode).toBe(200)
      const lista = r.json() as { nome: string; perfil: string }[]
      expect(lista.map((u) => u.nome).sort()).toEqual(['admin', 'cobrador', 'vendedorA', 'vendedorB'])
      expect(Object.keys(lista[0]).sort()).toEqual(['id', 'nome', 'perfil'])
    })
    it('os outros perfis não veem a equipe (403)', async () => {
      for (const papel of ['vendedorA', 'cobrador', 'indicador1']) expect((await req('GET', '/api/usuarios/responsaveis', papel)).statusCode).toBe(403)
    })
  })

  describe('busca e paginação', () => {
    it('por nome, sem diferenciar maiúscula', async () => expect(await nomes('admin', '?busca=BRUNO')).toEqual(['Bruno Lima']))
    it('por telefone, com ou sem pontuação', async () => {
      expect(await nomes('admin', `?busca=${encodeURIComponent('(11) 98812')}`)).toEqual(['Ana Souza'])
      expect(await nomes('admin', '?busca=11991027744')).toEqual(['Carla Dias'])
    })
    it('por CPF', async () => expect(await nomes('admin', `?busca=${encodeURIComponent('390.533')}`)).toEqual(['Ana Souza']))
    it('"%" é texto, não curinga', async () => expect(await nomes('admin', `?busca=${encodeURIComponent('%')}`)).toEqual(['Diego Prado 100%']))
    it('"_" também não é curinga', async () => expect(await nomes('admin', '?busca=_')).toEqual([]))
    it('a busca respeita o escopo', async () => expect(await nomes('vendedorA', '?busca=bruno')).toEqual([]))
    it('pagina e informa o total', async () => {
      const p1 = (await req('GET', '/api/clientes?limite=3&pagina=1', 'admin')).json()
      const p2 = (await req('GET', '/api/clientes?limite=3&pagina=2', 'admin')).json()
      expect(p1).toMatchObject({ total: 4, pagina: 1, limite: 3 })
      expect(p1.itens).toHaveLength(3)
      expect(p2.itens).toHaveLength(1)
    })
    it('limite absurdo é cortado em 100', async () => expect((await req('GET', '/api/clientes?limite=99999', 'admin')).json().limite).toBe(100))
  })

  describe('cadastro', () => {
    const base = { nome: '  Maria   da Silva ', fone: '(11) 95555-1234', cpf: CPF_A }

    it('admin cadastra: normaliza nome, telefone e CPF, e grava a auditoria', async () => {
      const r = await req('POST', '/api/clientes', 'admin', { ...base, endereco: 'Rua A, 1', origem: 'Instagram', responsavelId: id.vendedorA })
      expect(r.statusCode).toBe(201)
      const { cliente, avisos } = r.json()
      expect(cliente).toMatchObject({ nome: 'Maria da Silva', fone: '11955551234', cpf: '52998224725', endereco: 'Rua A, 1', origem: 'Instagram', responsavelId: id.vendedorA })
      expect(avisos).toEqual([])
      const aud = await db!('auditoria').where({ acao: 'CLIENTE_CRIADO', entidade_id: cliente.id }).first()
      expect(aud).toMatchObject({ usuario_id: id.admin })
      id.maria = cliente.id
    })

    it('CPF repetido é bloqueado (409), com ou sem pontuação', async () => {
      for (const cpf of [CPF_A, '52998224725']) {
        const r = await req('POST', '/api/clientes', 'admin', { ...base, fone: '11944440000', cpf })
        expect(r.statusCode).toBe(409)
        expect(r.json().codigo).toBe('CPF_DUPLICADO')
      }
    })

    it('telefone repetido só avisa e cadastra', async () => {
      const r = await req('POST', '/api/clientes', 'admin', { nome: 'Outra Pessoa', fone: '11988124410' })
      expect(r.statusCode).toBe(201)
      expect(r.json().avisos).toEqual(['Já existe um cliente com esse telefone: Ana Souza'])
    })

    it('o aviso de telefone repetido não revela cliente de outra carteira', async () => {
      // Bruno (11977612209) é da carteira do vendedor B; o vendedor A não pode descobrir o nome dele
      const r = await req('POST', '/api/clientes', 'vendedorA', { nome: 'Teste Vazamento', fone: '11977612209' })
      expect(r.statusCode).toBe(201)
      expect(r.json().avisos).toEqual(['Já existe um cliente com esse telefone, em outra carteira'])
      expect(JSON.stringify(r.json())).not.toContain('Bruno')
    })

    it('mostra o nome quando o outro cliente é da própria carteira', async () => {
      const r = await req('POST', '/api/clientes', 'vendedorA', { nome: 'Outra Ana', fone: '11988124410' })
      expect(r.json().avisos).toEqual(['Já existe um cliente com esse telefone: Ana Souza'])
    })

    it('CPF é opcional', async () => {
      const r = await req('POST', '/api/clientes', 'admin', { nome: 'Sem Cpf', fone: '11933330000' })
      expect(r.statusCode).toBe(201)
      expect(r.json().cliente.cpf).toBeNull()
    })

    it.each([
      ['sem nome', { fone: '11933330001' }],
      ['nome curto', { nome: 'A', fone: '11933330001' }],
      ['sem telefone', { nome: 'Fulano' }],
      ['telefone inválido', { nome: 'Fulano', fone: '123' }],
      ['CPF inválido', { nome: 'Fulano', fone: '11933330001', cpf: '111.111.111-11' }],
      ['CPF com dígito errado', { nome: 'Fulano', fone: '11933330001', cpf: '529.982.247-24' }],
      ['campo com tipo errado', { nome: 'Fulano', fone: '11933330001', endereco: 123 }],
      ['endereço enorme', { nome: 'Fulano', fone: '11933330001', endereco: 'x'.repeat(501) }],
    ])('recusa %s (400)', async (_n, corpo) => expect((await req('POST', '/api/clientes', 'admin', corpo)).statusCode).toBe(400))

    it('responsável precisa ser um usuário ativo que não seja indicador', async () => {
      for (const responsavelId of [id.indicador1, 99999, 'abc']) {
        const r = await req('POST', '/api/clientes', 'admin', { nome: 'Fulano', fone: '11933330002', responsavelId })
        expect(r.statusCode).toBe(400)
      }
    })

    it('vendedor cadastra sempre na própria carteira, mesmo pedindo outro responsável', async () => {
      const r = await req('POST', '/api/clientes', 'vendedorA', { nome: 'Do Vendedor', fone: '11933330003', responsavelId: id.vendedorB })
      expect(r.statusCode).toBe(201)
      expect(r.json().cliente.responsavelId).toBe(id.vendedorA)
      expect(await nomes('vendedorA')).toContain('Do Vendedor')
      expect(await nomes('vendedorB')).not.toContain('Do Vendedor')
    })

    it('cobrador e indicador não cadastram (403)', async () => {
      for (const papel of ['cobrador', 'indicador1'])
        expect((await req('POST', '/api/clientes', papel, { nome: 'Fulano', fone: '11933330004' })).statusCode).toBe(403)
    })

    it('sem login, 401', async () => expect((await req('POST', '/api/clientes', undefined, base)).statusCode).toBe(401))
  })

  describe('edição', () => {
    it('admin edita só o que mandou; o resto fica como estava', async () => {
      const r = await req('PATCH', `/api/clientes/${id.maria}`, 'admin', { endereco: 'Rua B, 2' })
      expect(r.statusCode).toBe(200)
      expect(r.json().cliente).toMatchObject({ nome: 'Maria da Silva', cpf: '52998224725', endereco: 'Rua B, 2', origem: 'Instagram' })
    })

    it('grava a auditoria com o antes e o depois', async () => {
      await req('PATCH', `/api/clientes/${id.maria}`, 'admin', { origem: 'Indicação' })
      const aud = await db!('auditoria').where({ acao: 'CLIENTE_ALTERADO', entidade_id: id.maria }).orderBy('id', 'desc').first()
      expect(aud.antes.origem).toBe('Instagram')
      expect(aud.depois.origem).toBe('Indicação')
    })

    it('dá para limpar um campo opcional', async () => {
      const r = await req('PATCH', `/api/clientes/${id.maria}`, 'admin', { endereco: '', cpf: null })
      expect(r.json().cliente).toMatchObject({ endereco: null, cpf: null })
    })

    it('CPF de outro cliente é bloqueado; o próprio CPF pode ser reenviado', async () => {
      expect((await req('PATCH', `/api/clientes/${id.maria}`, 'admin', { cpf: '390.533.447-05' })).statusCode).toBe(409)
      expect((await req('PATCH', `/api/clientes/${id.c1}`, 'admin', { cpf: '390.533.447-05' })).statusCode).toBe(200)
    })

    it('validações valem na edição também', async () => {
      expect((await req('PATCH', `/api/clientes/${id.maria}`, 'admin', { fone: 'abc' })).statusCode).toBe(400)
      expect((await req('PATCH', `/api/clientes/${id.maria}`, 'admin', { nome: ' ' })).statusCode).toBe(400)
    })

    it('telefone igual ao de outro cliente avisa, mas não avisa de si mesmo', async () => {
      expect((await req('PATCH', `/api/clientes/${id.maria}`, 'admin', { fone: '11977612209' })).json().avisos.join()).toContain('Bruno Lima')
      expect((await req('PATCH', `/api/clientes/${id.maria}`, 'admin', { fone: '11977612209' })).json().avisos).toEqual([])
    })

    it('vendedor edita cliente da carteira dele, mas não os dos outros (404)', async () => {
      expect((await req('PATCH', `/api/clientes/${id.c1}`, 'vendedorA', { origem: 'Loja' })).statusCode).toBe(200)
      expect((await req('PATCH', `/api/clientes/${id.c2}`, 'vendedorA', { origem: 'Loja' })).statusCode).toBe(404)
    })

    it('só o admin muda o responsável', async () => {
      expect((await req('PATCH', `/api/clientes/${id.c1}`, 'vendedorA', { responsavelId: id.vendedorB })).statusCode).toBe(403)
      expect((await req('PATCH', `/api/clientes/${id.c4}`, 'admin', { responsavelId: id.cobrador })).statusCode).toBe(200)
      expect(await nomes('cobrador')).toContain('Diego Prado 100%')
    })

    it('cobrador e indicador não editam (403)', async () => {
      expect((await req('PATCH', `/api/clientes/${id.c3}`, 'cobrador', { origem: 'x' })).statusCode).toBe(403)
      expect((await req('PATCH', `/api/clientes/${id.c1}`, 'indicador1', { origem: 'x' })).statusCode).toBe(403)
    })

    it('id inexistente é 404 e id inválido é 400', async () => {
      expect((await req('PATCH', '/api/clientes/99999', 'admin', { origem: 'x' })).statusCode).toBe(404)
      expect((await req('GET', '/api/clientes/abc', 'admin')).statusCode).toBe(400)
    })
  })
})
