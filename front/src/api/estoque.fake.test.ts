import { beforeEach, describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { ErroApi } from './clientes'
import { investidoApi, type EntradaAparelho, type EstoqueApi } from './estoque'
import { criarEstoqueFake } from './estoque.fake'

// Mesmos cenários de back/tests/estoque.test.ts: a demonstração tem de se comportar como o backend.
const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const VEND: Sessao = { perfil: 'VENDEDOR', usuarioId: 2 } // carteira: Juliana, Lucas, Mariana, Patrícia (a Patrícia encomendou o iPhone 16 Pro)
const VEND_B: Sessao = { perfil: 'VENDEDOR', usuarioId: 99 }
const COBR: Sessao = { perfil: 'COBRADOR', usuarioId: 3 }
const IND: Sessao = { perfil: 'INDICADOR', indicadorId: 1 }

let api: EstoqueApi
beforeEach(() => { api = criarEstoqueFake() })
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)
const novo = (extra: EntradaAparelho = {}): EntradaAparelho => ({ modelo: 'iPhone 13', gb: 128, cor: 'Meia-noite', preco: 3600, custo: 2150, extras: 80, bateria: 88, dataCompra: '2026-09-29', ...extra })

/** IMEI válido a partir de um número (14 dígitos + verificador de Luhn). */
function imei(n: number) {
  const base = String(35000000000000 + n)
  let soma = 0
  for (let i = 0; i < 14; i++) { let d = Number(base[13 - i]); if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9 } soma += d }
  return base + String((10 - (soma % 10)) % 10)
}

describe('permissões', () => {
  it('cobrador não vê o estoque (403)', async () => {
    expect((await falha(api.listar(COBR, {})))?.status).toBe(403)
    expect((await falha(api.resumo(COBR)))?.status).toBe(403)
    expect((await falha(api.obter(COBR, 1)))?.status).toBe(403)
  })
  it('indicador consulta só o que está disponível, sem custo, extras nem para quem é; não vê o resumo nem mexe (403)', async () => {
    const itens = (await api.listar(IND, { limite: 100 })).itens
    expect(itens.length).toBeGreaterThan(0)
    for (const a of itens) {
      expect(a.estado).toBe('DISPONIVEL')
      for (const campo of ['custo', 'extras', 'observacoes']) expect(campo in a, campo).toBe(false)
      expect(a.paraCliente).toBeNull()
    }
    expect((await api.obter(IND, itens[0].id)).id).toBe(itens[0].id)
    expect((await falha(api.resumo(IND)))?.status).toBe(403)
    expect((await falha(api.criar(IND, novo())))?.status).toBe(403)
    expect((await falha(api.atualizar(IND, itens[0].id, { preco: 1 })))?.status).toBe(403)
  })
  it('indicador não abre aparelho vendido nem encomendado (404, igual a inexistente)', async () => {
    const todos = (await api.listar(ADMIN, { limite: 100 })).itens
    for (const a of todos.filter((x) => x.estado !== 'DISPONIVEL')) expect((await falha(api.obter(IND, a.id)))?.status).toBe(404)
    expect((await falha(api.obter(IND, 999999)))?.status).toBe(404)
  })
  it('vendedor não cadastra nem edita (403)', async () => {
    expect((await falha(api.criar(VEND, novo())))?.status).toBe(403)
    expect((await falha(api.atualizar(VEND, 1, { preco: 1 })))?.status).toBe(403)
  })
})

describe('cadastro', () => {
  it('admin cadastra e normaliza o texto; usa os padrões', async () => {
    const a = await api.criar(ADMIN, novo({ modelo: '  iPhone   13 ', imei: '49-015420-323751-8' }))
    expect(a).toMatchObject({ modelo: 'iPhone 13', imei: '490154203237518', estado: 'DISPONIVEL', custo: 2150, extras: 80, preco: 3600 })
    const p = await api.criar(ADMIN, { modelo: 'iPhone 12', gb: 64, cor: 'Branco', preco: 2400 })
    expect(p).toMatchObject({ condicao: 'Seminovo', origem: 'COMPRA', bateria: 100, custo: 0, extras: 0, imei: null })
  })
  it.each([
    ['modelo curto', { modelo: 'i' }], ['GB com vírgula', { gb: 12.5 }], ['sem cor', { cor: '' }], ['bateria acima de 100', { bateria: 101 }],
    ['condição inventada', { condicao: 'Quebrado' }], ['origem inventada', { origem: 'ROUBO' }], ['preço zero', { preco: 0 }], ['preço como texto', { preco: '3600' }],
    ['custo negativo', { custo: -1 }], ['custo absurdo', { custo: 1e12 }], ['data inválida', { dataCompra: '2026-02-31' }], ['observação enorme', { observacoes: 'x'.repeat(501) }],
  ])('recusa %s (400)', async (_n, m) => expect((await falha(api.criar(ADMIN, novo(m as EntradaAparelho))))?.status).toBe(400))
})

describe('IMEI', () => {
  it('recusa dígito verificador errado e tamanho errado', async () => {
    for (const i of ['490154203237519', '123456789012345', '49015420323751', 'abc']) expect((await falha(api.criar(ADMIN, novo({ imei: i }))))?.status).toBe(400)
  })
  it('repetido é 409, com ou sem separadores; sem IMEI convivem vários', async () => {
    await api.criar(ADMIN, novo({ imei: '490154203237518' }))
    for (const i of ['490154203237518', '49-015420-323751-8']) expect(await falha(api.criar(ADMIN, novo({ imei: i })))).toMatchObject({ status: 409, codigo: 'IMEI_DUPLICADO' })
    await api.criar(ADMIN, novo())
    expect((await api.criar(ADMIN, novo())).imei).toBeNull()
  })
  it('IMEI antigo (inválido) não impede de editar o preço, mas trocar por outro inválido é recusado', async () => {
    const a = (await api.listar(ADMIN, { estado: 'DISPONIVEL' })).itens.find((x) => x.imei)! // os do exemplo não passam no dígito verificador
    expect((await api.atualizar(ADMIN, a.id, { preco: 1234, imei: a.imei })).preco).toBe(1234)
    expect((await falha(api.atualizar(ADMIN, a.id, { imei: '352918114471204' })))?.status).toBe(400)
  })
  it('editar para o IMEI de outro é 409; o próprio IMEI passa; null limpa', async () => {
    await api.criar(ADMIN, novo({ imei: '490154203237518' }))
    const b = await api.criar(ADMIN, novo({ imei: imei(1) }))
    expect((await falha(api.atualizar(ADMIN, b.id, { imei: '490154203237518' })))?.status).toBe(409)
    expect((await api.atualizar(ADMIN, b.id, { imei: imei(1) })).imei).toBe(imei(1))
    expect((await api.atualizar(ADMIN, b.id, { imei: null })).imei).toBeNull()
  })
})

describe('estado e encomenda', () => {
  it('encomendado precisa de um cliente que exista', async () => {
    expect((await falha(api.criar(ADMIN, novo({ estado: 'ENCOMENDADO' }))))?.status).toBe(400)
    expect((await falha(api.criar(ADMIN, novo({ estado: 'ENCOMENDADO', paraClienteId: 99999 }))))?.status).toBe(400)
    expect(await api.criar(ADMIN, novo({ estado: 'ENCOMENDADO', paraClienteId: 1 }))).toMatchObject({ estado: 'ENCOMENDADO', paraCliente: { id: 1, nome: 'Juliana Prado' } })
  })
  it('disponível não tem cliente; "vendido" não se escolhe', async () => {
    expect((await falha(api.criar(ADMIN, novo({ paraClienteId: 1 }))))?.status).toBe(400)
    expect((await falha(api.criar(ADMIN, novo({ estado: 'VENDIDO' as never }))))?.status).toBe(400)
  })
  it('alterna entre disponível e encomendado, limpando o cliente ao voltar', async () => {
    const a = await api.criar(ADMIN, novo())
    expect(await api.atualizar(ADMIN, a.id, { estado: 'ENCOMENDADO', paraClienteId: 2 })).toMatchObject({ estado: 'ENCOMENDADO', paraCliente: { id: 2 } })
    expect(await api.atualizar(ADMIN, a.id, { estado: 'DISPONIVEL' })).toMatchObject({ estado: 'DISPONIVEL', paraCliente: null })
  })
  it('aparelho vendido é somente leitura (409)', async () => {
    const vendido = (await api.listar(ADMIN, { estado: 'VENDIDO' })).itens[0]
    expect(await falha(api.atualizar(ADMIN, vendido.id, { preco: 1 }))).toMatchObject({ status: 409, codigo: 'APARELHO_VENDIDO' })
  })
})

describe('lista e busca', () => {
  it('admin vê todos os estados, com custo e extras', async () => {
    const r = await api.listar(ADMIN, { limite: 100 })
    expect(new Set(r.itens.map((a) => a.estado))).toEqual(new Set(['DISPONIVEL', 'ENCOMENDADO', 'VENDIDO']))
    expect(r.itens.every((a) => a.custo !== undefined && a.extras !== undefined)).toBe(true)
  })
  it('filtra por estado e recusa estado inventado', async () => {
    expect((await api.listar(ADMIN, { estado: 'VENDIDO' })).itens.every((a) => a.estado === 'VENDIDO')).toBe(true)
    expect((await falha(api.listar(ADMIN, { estado: 'XYZ' as never })))?.status).toBe(400)
  })
  it('busca por modelo, cor e parte do IMEI, sem diferenciar maiúscula; "%" é texto', async () => {
    const nomes = async (b: string) => (await api.listar(ADMIN, { busca: b, limite: 100 })).itens.map((a) => a.modelo)
    expect((await nomes('IPHONE 16 PRO')).every((m) => m === 'iPhone 16 Pro')).toBe(true)
    expect((await nomes('branco')).length).toBeGreaterThan(0)
    expect((await nomes('0154')).length).toBe(0) // IMEI do exemplo não tem esse trecho
    expect(await nomes('%')).toEqual([])
  })
  it('pagina, informa o total, corta o limite em 100 e mostra os mais novos primeiro', async () => {
    const p1 = await api.listar(ADMIN, { limite: 5, pagina: 1 })
    const p2 = await api.listar(ADMIN, { limite: 5, pagina: 2 })
    expect(p1.total).toBeGreaterThan(5)
    expect(p2.itens[0].id).not.toBe(p1.itens[0].id)
    expect((await api.listar(ADMIN, { limite: 99999 })).limite).toBe(100)
    const datas = (await api.listar(ADMIN, { limite: 100 })).itens.map((a) => a.dataCompra)
    expect(datas).toEqual([...datas].sort().reverse())
  })
})

describe('vendedor: nunca vê custo', () => {
  it('as respostas nem têm os campos de custo, extras e observações', async () => {
    const lista = JSON.stringify(await api.listar(VEND, { limite: 100 }))
    const ficha = JSON.stringify(await api.obter(VEND, (await api.listar(VEND, {})).itens[0].id))
    const resumo = JSON.stringify(await api.resumo(VEND))
    for (const corpo of [lista, ficha, resumo]) expect(corpo).not.toMatch(/custo|extras|observacoes|capitalParado|margem/i)
  })
  it('vê o preço e só o que está à venda (sem vendidos)', async () => {
    const r = await api.listar(VEND, { limite: 100 })
    expect(r.itens.every((a) => a.preco > 0 && a.estado !== 'VENDIDO')).toBe(true)
    expect((await api.listar(VEND, { estado: 'VENDIDO' })).total).toBe(0)
    const vendido = (await api.listar(ADMIN, { estado: 'VENDIDO' })).itens[0]
    expect((await falha(api.obter(VEND, vendido.id)))?.status).toBe(404)
  })
  it('só vê quem encomendou se o cliente é da carteira dele', async () => {
    const enc = (await api.listar(ADMIN, { estado: 'ENCOMENDADO' })).itens.find((a) => a.paraCliente?.id === 9)! // Patrícia (carteira do vendedor 2)
    expect((await api.obter(VEND, enc.id)).paraCliente).toMatchObject({ nome: 'Patrícia Gomes' })
    const deOutro = await api.obter(VEND_B, enc.id)
    expect(deOutro.estado).toBe('ENCOMENDADO')
    expect(deOutro.paraCliente).toBeNull()
    expect(JSON.stringify(await api.listar(VEND_B, { limite: 100 }))).not.toContain('Patrícia')
  })
})

describe('resumo', () => {
  it('admin recebe capital parado e margem; vendedor só contagens e valor em vitrine', async () => {
    const disp = (await api.listar(ADMIN, { estado: 'DISPONIVEL', limite: 100 })).itens
    const adm = await api.resumo(ADMIN)
    expect(adm.disponiveis).toBe(disp.length)
    expect(adm.capitalParado).toBeCloseTo(disp.reduce((s, a) => s + investidoApi(a), 0), 2)
    expect(adm.valorEmVitrine).toBeCloseTo(disp.reduce((s, a) => s + a.preco, 0), 2)
    expect(adm.margemMedia).toBeGreaterThan(0)
    const v = await api.resumo(VEND)
    expect(Object.keys(v).sort()).toEqual(['disponiveis', 'encomendados', 'valorEmVitrine'])
  })
})
