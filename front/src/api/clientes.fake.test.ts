import { beforeEach, describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { ErroApi, type ClientesApi } from './clientes'
import { criarClientesFake } from './clientes.fake'

// A versão de demonstração precisa se comportar igual ao backend (que tem os mesmos cenários em back/tests/clientes.test.ts).
const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const VEND: Sessao = { perfil: 'VENDEDOR', usuarioId: 2 }
const COBR: Sessao = { perfil: 'COBRADOR', usuarioId: 3 }
const IND1: Sessao = { perfil: 'INDICADOR', indicadorId: 1 }
const IND2: Sessao = { perfil: 'INDICADOR', indicadorId: 2 }

let api: ClientesApi
beforeEach(() => { api = criarClientesFake() })

const nomes = async (s: Sessao, busca?: string) => (await api.listar(s, { busca, limite: 100 })).itens.map((c) => c.nome)
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)

describe('escopo por perfil', () => {
  it('admin vê todos', async () => expect(await nomes(ADMIN)).toHaveLength(9))
  it('vendedor e cobrador veem só a carteira deles', async () => {
    expect(await nomes(VEND)).toHaveLength(4)
    expect((await nomes(COBR)).every((n) => !(['Juliana Prado', 'Lucas Martins']).includes(n))).toBe(true)
    expect(await nomes(VEND)).not.toEqual(await nomes(COBR))
  })
  it('indicador vê só quem indicou, sem CPF, RG nem endereço', async () => {
    const r = await api.listar(IND1, { limite: 100 })
    expect(r.itens.length).toBeGreaterThan(0)
    for (const c of r.itens) expect(Object.keys(c).sort()).toEqual(['desde', 'fone', 'id', 'nome'])
    const outros = (await api.listar(IND2, { limite: 100 })).itens.map((c) => c.id)
    expect(r.itens.some((c) => outros.includes(c.id) && !r.itens.find((x) => x.id === c.id))).toBe(false)
  })
  it('cliente fora do escopo dá 404', async () => {
    const alheio = (await api.listar(ADMIN, { limite: 100 })).itens.find((c) => c.responsavelId === 3)!
    const e = await falha(api.obter(VEND, alheio.id))
    expect(e?.status).toBe(404)
  })
})

describe('busca e paginação', () => {
  it('por nome, telefone (com pontuação) e CPF', async () => {
    expect(await nomes(ADMIN, 'CARLOS')).toEqual(['Carlos Henrique Souza'])
    expect(await nomes(ADMIN, '(11) 99633')).toEqual(['Mariana Lopes'])
    await api.criar(ADMIN, { nome: 'Com Cpf', fone: '11955551111', cpf: '529.982.247-25' })
    expect(await nomes(ADMIN, '529.982')).toEqual(['Com Cpf'])
  })
  it('pagina e informa o total', async () => {
    const p1 = await api.listar(ADMIN, { limite: 4, pagina: 1 })
    const p3 = await api.listar(ADMIN, { limite: 4, pagina: 3 })
    expect(p1).toMatchObject({ total: 9, pagina: 1, limite: 4 })
    expect(p1.itens).toHaveLength(4)
    expect(p3.itens).toHaveLength(1)
  })
  it('limite absurdo é cortado em 100', async () => expect((await api.listar(ADMIN, { limite: 99999 })).limite).toBe(100))
})

describe('cadastro', () => {
  const base = { nome: '  Maria   da Silva ', fone: '(11) 95555-1234', cpf: '529.982.247-25' }

  it('normaliza nome, telefone e CPF', async () => {
    const { cliente } = await api.criar(ADMIN, { ...base, responsavelId: 2 })
    expect(cliente).toMatchObject({ nome: 'Maria da Silva', fone: '11955551234', cpf: '52998224725', responsavelId: 2 })
  })
  it('CPF repetido é 409, com ou sem pontuação', async () => {
    await api.criar(ADMIN, base)
    for (const cpf of ['529.982.247-25', '52998224725']) {
      const e = await falha(api.criar(ADMIN, { nome: 'Outro', fone: '11944440000', cpf }))
      expect(e).toMatchObject({ status: 409, codigo: 'CPF_DUPLICADO' })
    }
  })
  it('CPF é opcional', async () => expect((await api.criar(ADMIN, { nome: 'Sem Cpf', fone: '11933330000' })).cliente.cpf).toBeNull())
  it.each([
    ['sem nome', { fone: '11933330001' }], ['nome curto', { nome: 'A', fone: '11933330001' }], ['sem telefone', { nome: 'Fulano' }],
    ['telefone inválido', { nome: 'Fulano', fone: '123' }], ['CPF inválido', { nome: 'Fulano', fone: '11933330001', cpf: '111.111.111-11' }],
  ])('recusa %s (400)', async (_n, corpo) => expect((await falha(api.criar(ADMIN, corpo as never)))?.status).toBe(400))

  it('telefone repetido só avisa, com o nome se o outro cliente é visível', async () => {
    const r = await api.criar(ADMIN, { nome: 'Outra Pessoa', fone: '(11) 99633-0921' })
    expect(r.avisos).toEqual(['Já existe um cliente com esse telefone: Mariana Lopes'])
  })
  it('o aviso não revela cliente de outra carteira', async () => {
    // Mariana Lopes é da carteira do vendedor (id 2); o cobrador (id 3) não pode descobrir o nome
    const r = await api.criar({ perfil: 'VENDEDOR', usuarioId: 3 }, { nome: 'Teste Vazamento', fone: '(11) 99633-0921' })
    expect(r.avisos).toEqual(['Já existe um cliente com esse telefone, em outra carteira'])
    expect(JSON.stringify(r)).not.toContain('Mariana')
  })
  it('vendedor cadastra sempre na própria carteira, mesmo pedindo outro responsável', async () => {
    const { cliente } = await api.criar(VEND, { nome: 'Do Vendedor', fone: '11933330003', responsavelId: 3 })
    expect(cliente.responsavelId).toBe(2)
    expect(await nomes(VEND)).toContain('Do Vendedor')
  })
  it('cobrador e indicador não cadastram (403)', async () => {
    for (const s of [COBR, IND1]) expect((await falha(api.criar(s, { nome: 'Fulano', fone: '11933330004' })))?.status).toBe(403)
  })
})

describe('edição', () => {
  it('só muda o que veio e permite limpar campos opcionais', async () => {
    const { cliente } = await api.criar(ADMIN, { nome: 'Edita Ele', fone: '11922220000', cpf: '529.982.247-25', endereco: 'Rua A' })
    const r = await api.atualizar(ADMIN, cliente.id, { endereco: 'Rua B' })
    expect(r.cliente).toMatchObject({ nome: 'Edita Ele', cpf: '52998224725', endereco: 'Rua B' })
    expect((await api.atualizar(ADMIN, cliente.id, { cpf: null, endereco: '' })).cliente).toMatchObject({ cpf: null, endereco: null })
  })
  it('CPF de outro cliente é 409; o próprio CPF pode ser reenviado', async () => {
    const a = (await api.criar(ADMIN, { nome: 'Cliente A', fone: '11911110000', cpf: '529.982.247-25' })).cliente
    const b = (await api.criar(ADMIN, { nome: 'Cliente B', fone: '11911110001' })).cliente
    expect((await falha(api.atualizar(ADMIN, b.id, { cpf: '529.982.247-25' })))?.status).toBe(409)
    expect((await api.atualizar(ADMIN, a.id, { cpf: '529.982.247-25' })).cliente.id).toBe(a.id)
  })
  it('vendedor edita a própria carteira (404 nas dos outros) e não muda o responsável (403)', async () => {
    const meu = (await api.listar(VEND, { limite: 100 })).itens[0]
    expect((await api.atualizar(VEND, meu.id, { origem: 'Loja' })).cliente.origem).toBe('Loja')
    expect((await falha(api.atualizar(VEND, meu.id, { responsavelId: 3 })))?.status).toBe(403)
    const alheio = (await api.listar(ADMIN, { limite: 100 })).itens.find((c) => c.responsavelId === 3)!
    expect((await falha(api.atualizar(VEND, alheio.id, { origem: 'x' })))?.status).toBe(404)
  })
  it('cobrador e indicador não editam (403)', async () => {
    const c = (await api.listar(COBR, { limite: 100 })).itens[0]
    expect((await falha(api.atualizar(COBR, c.id, { origem: 'x' })))?.status).toBe(403)
  })
  it('só o admin vê a lista de responsáveis', async () => {
    expect((await api.responsaveis(ADMIN)).length).toBeGreaterThan(0)
    expect((await falha(api.responsaveis(VEND)))?.status).toBe(403)
  })
})
