import { beforeEach, describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { ErroApi, type ClientesApi } from './clientes'
import { criarClientesFake } from './clientes.fake'
import { criarEmprestimosFake } from './emprestimos.fake'
import { criarEstoqueFake } from './estoque.fake'
import { criarIndicadoresFake } from './indicadores.fake'
import type { EntradaProposta, PropostasApi } from './propostas'
import { criarPropostasFake } from './propostas.fake'
import { criarVendasFake } from './vendas.fake'

// Mesmos cenários de back/tests/propostas.test.ts: a demonstração tem de se comportar como o backend.
const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const VEND: Sessao = { perfil: 'VENDEDOR', usuarioId: 2 }
const COBR: Sessao = { perfil: 'COBRADOR', usuarioId: 3 }
const IND1: Sessao = { perfil: 'INDICADOR', indicadorId: 1 }
const IND2: Sessao = { perfil: 'INDICADOR', indicadorId: 2 }
const CPFS = ['52998224725', '11144477735', '39053344705', '16899535009']
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)

let api: PropostasApi
let clientes: ClientesApi
let vendas: ReturnType<typeof criarVendasFake>
let emprestimos: ReturnType<typeof criarEmprestimosFake>
let estoque: ReturnType<typeof criarEstoqueFake>
let cpfN = 0
beforeEach(() => {
  cpfN = 0
  clientes = criarClientesFake(); estoque = criarEstoqueFake(); const indicadores = criarIndicadoresFake()
  vendas = criarVendasFake({ estoque, indicadores, clientes })
  emprestimos = criarEmprestimosFake({ clientes, indicadores })
  api = criarPropostasFake({ clientes, estoque, vendas, emprestimos, indicadores, hoje: vendas._interno.hoje })
})
const cliente = async (s: Sessao = IND1) => (await clientes.criar(s, { nome: 'Cliente ' + cpfN, fone: '1198812' + (4000 + cpfN), cpf: CPFS[cpfN++ % CPFS.length] })).cliente.id
const propor = (s: Sessao, e: Partial<EntradaProposta> & { clienteId: number }) => api.criar(s, { tipo: 'VENDA', interesse: 'iPhone 14 128 GB', ...e })
async function venda(clienteId: number, indicadorId: number | null = 1) {
  const aparelho = (await estoque.listar(ADMIN, { estado: 'DISPONIVEL', limite: 1 })).itens[0]
  return (await vendas.criar(ADMIN, { aparelhoId: aparelho.id, clienteId, preco: aparelho.preco, entrada: 600, parcelas: 4, diaVencimento: 10, indicadorId })).id
}
const emp = async (clienteId: number, indicadorId: number | null = 1) => (await emprestimos.criar(ADMIN, { clienteId, modalidade: 'PARCELADO', capital: 1000, taxa: 30, parcelas: 2, indicadorId })).id

describe('quem pode mandar e ver', () => {
  it('só o indicador manda (403 para os outros)', async () => {
    const c = await cliente()
    for (const s of [ADMIN, VEND, COBR]) expect((await falha(propor(s, { clienteId: c })))?.status).toBe(403)
  })
  it('vendedor e cobrador não leem propostas (403)', async () => {
    for (const s of [VEND, COBR]) expect((await falha(api.listar(s, {})))?.status).toBe(403)
  })
  it('cliente de outro indicador ou inexistente: 404 igual', async () => {
    const dela = await cliente(IND2)
    const a = await falha(propor(IND1, { clienteId: dela })); const b = await falha(propor(IND1, { clienteId: 999999 }))
    expect([a?.status, b?.status]).toEqual([404, 404])
    expect(a?.message).toBe(b?.message)
  })
})

describe('criar', () => {
  it('venda com aparelho: guarda o aparelho e monta o texto do interesse', async () => {
    const c = await cliente()
    const ap = (await estoque.listar(ADMIN, { limite: 1 })).itens[0]
    const p = await api.criar(IND1, { clienteId: c, tipo: 'VENDA', aparelhoId: ap.id, parcelas: 10, obs: 'quer entrada baixa' })
    expect(p).toMatchObject({ tipo: 'VENDA', status: 'PENDENTE', interesse: `${ap.modelo} ${ap.gb} GB ${ap.cor}`, parcelas: 10, obs: 'quer entrada baixa', aparelho: { id: ap.id }, operacao: null })
  })
  it('empréstimo com valor', async () => {
    const p = await api.criar(IND1, { clienteId: await cliente(), tipo: 'EMPRESTIMO', valor: 5000.5, parcelas: 6 })
    expect(p).toMatchObject({ tipo: 'EMPRESTIMO', valor: 5000.5, parcelas: 6, interesse: null, aparelho: null })
  })
  it.each([
    ['sem tipo', { tipo: undefined }], ['tipo inválido', { tipo: 'TROCA' }], ['sem cliente', { clienteId: undefined }], ['cliente zero', { clienteId: 0 }],
    ['interesse enorme', { interesse: 'x'.repeat(161) }], ['obs enorme', { obs: 'x'.repeat(501) }],
    ['valor zero', { valor: 0 }], ['valor negativo', { valor: -1 }], ['valor gigante', { valor: 1e9 }],
    ['parcelas zero', { parcelas: 0 }], ['parcelas 121', { parcelas: 121 }], ['parcelas quebradas', { parcelas: 2.5 }],
    ['aparelho inexistente', { aparelhoId: 999999 }], ['nada dito (sem interesse nem valor)', { interesse: undefined }],
  ])('recusa %s (400) e não grava nada', async (_n, m) => {
    const c = await cliente()
    const corpo = { clienteId: c, tipo: 'VENDA', interesse: 'iPhone 14', ...m } as Record<string, unknown>
    for (const k of Object.keys(corpo)) if (corpo[k] === undefined) delete corpo[k]
    expect((await falha(api.criar(IND1, corpo as never)))?.status).toBe(400)
    expect((await api.listar(ADMIN, {})).total).toBe(0)
  })
  it('aparelho em proposta de empréstimo: 400', async () => {
    const ap = (await estoque.listar(ADMIN, { limite: 1 })).itens[0]
    expect((await falha(api.criar(IND1, { clienteId: await cliente(), tipo: 'EMPRESTIMO', aparelhoId: ap.id, valor: 1000 })))?.status).toBe(400)
  })
})

describe('listar e ver', () => {
  it('o administrador vê todas; o indicador, só as dele; pendentes primeiro; conta as pendentes', async () => {
    const a = await cliente(IND1); const b = await cliente(IND2)
    const p1 = (await propor(IND1, { clienteId: a })).id
    const p2 = (await propor(IND2, { clienteId: b })).id
    const p3 = (await propor(IND1, { clienteId: a, interesse: 'iPhone 11' })).id
    await api.recusar(ADMIN, p1)
    const todas = await api.listar(ADMIN, {})
    expect([todas.total, todas.pendentes]).toEqual([3, 2])
    expect(todas.itens.map((p) => p.id)).toEqual([p3, p2, p1])
    const dele = await api.listar(IND1, {})
    expect(dele.itens.map((p) => p.id).sort()).toEqual([p1, p3].sort())
    expect(dele.itens.every((p) => p.indicador.id === 1)).toBe(true)
    expect(dele.itens.map((p) => p.id)).not.toContain(p2)
  })
  it('filtra por status e por indicador (o filtro de indicador só vale para o admin)', async () => {
    const a = await cliente(IND1); const b = await cliente(IND2)
    const p1 = (await propor(IND1, { clienteId: a })).id; await propor(IND2, { clienteId: b })
    await api.recusar(ADMIN, p1)
    expect((await api.listar(ADMIN, { status: 'RECUSADA' })).total).toBe(1)
    expect((await api.listar(ADMIN, { indicadorId: 2 })).total).toBe(1)
    expect((await api.listar(IND1, { indicadorId: 2 })).total).toBe(1) // continua só as dele
    expect((await falha(api.listar(ADMIN, { status: 'XYZ' as never })))?.status).toBe(400)
  })
  it('a proposta de outro indicador é 404, igual a uma que não existe', async () => {
    const p = await propor(IND2, { clienteId: await cliente(IND2) })
    expect((await falha(api.obter(IND1, p.id)))?.status).toBe(404)
    expect((await falha(api.obter(IND1, 999999)))?.status).toBe(404)
    expect((await api.obter(ADMIN, p.id)).id).toBe(p.id)
  })
})

describe('a loja aceita', () => {
  it('só o administrador (403 para os outros)', async () => {
    const p = await propor(IND1, { clienteId: await cliente() })
    for (const s of [IND1, VEND, COBR]) expect((await falha(api.aceitar(s, p.id)))?.status).toBe(403)
    expect((await api.obter(ADMIN, p.id)).status).toBe('PENDENTE')
  })
  it('aceita sem ligar a nada, e ligando à venda ou ao empréstimo do mesmo cliente e indicador', async () => {
    const c = await cliente()
    const a = await propor(IND1, { clienteId: c }); expect(await api.aceitar(ADMIN, a.id)).toMatchObject({ status: 'ACEITA', operacao: null })
    const v = await venda(c); const b = await propor(IND1, { clienteId: c })
    expect((await api.aceitar(ADMIN, b.id, { vendaId: v })).operacao).toEqual({ tipo: 'VENDA', id: v })
    const e = await emp(c); const d = await propor(IND1, { clienteId: c, tipo: 'EMPRESTIMO', interesse: undefined, valor: 1000 })
    expect((await api.aceitar(ADMIN, d.id, { emprestimoId: e })).operacao).toEqual({ tipo: 'EMPRESTIMO', id: e })
  })
  it('recusa ligar operação de outro cliente, de outro indicador, sem indicador ou de tipo errado; a proposta segue pendente', async () => {
    const c = await cliente(); const p = await propor(IND1, { clienteId: c })
    const casos = [{ vendaId: await venda(await cliente()) }, { vendaId: await venda(c, 2) }, { vendaId: await venda(c, null) }, { emprestimoId: await emp(c) }, { vendaId: 999999 }, { vendaId: 1, emprestimoId: 1 }]
    for (const corpo of casos) expect([400, 404]).toContain((await falha(api.aceitar(ADMIN, p.id, corpo)))?.status)
    expect((await api.obter(ADMIN, p.id)).status).toBe('PENDENTE')
  })
  it('a mesma venda não liga a duas propostas (409) e a segunda segue pendente', async () => {
    const c = await cliente(); const v = await venda(c)
    const p1 = await propor(IND1, { clienteId: c }); const p2 = await propor(IND1, { clienteId: c, interesse: 'outro' })
    await api.aceitar(ADMIN, p1.id, { vendaId: v })
    expect(await falha(api.aceitar(ADMIN, p2.id, { vendaId: v }))).toMatchObject({ status: 409, codigo: 'OPERACAO_JA_LIGADA' })
    expect((await api.obter(ADMIN, p2.id)).status).toBe('PENDENTE')
  })
  it('aceitar duas vezes: 409 PROPOSTA_JA_RESPONDIDA; inexistente 404', async () => {
    const p = await propor(IND1, { clienteId: await cliente() })
    await api.aceitar(ADMIN, p.id)
    expect((await falha(api.aceitar(ADMIN, p.id)))?.codigo).toBe('PROPOSTA_JA_RESPONDIDA')
    expect((await falha(api.aceitar(ADMIN, 999999)))?.status).toBe(404)
  })
})

describe('a loja recusa e o indicador cancela', () => {
  it('recusar guarda o motivo e o indicador o vê; sem motivo vale; só admin; já respondida 409', async () => {
    const c = await cliente()
    const p = await propor(IND1, { clienteId: c })
    expect((await falha(api.recusar(IND1, p.id)))?.status).toBe(403)
    expect((await falha(api.recusar(ADMIN, p.id, { motivo: 'x'.repeat(301) })))?.status).toBe(400)
    await api.recusar(ADMIN, p.id, { motivo: 'Cliente sem renda comprovada' })
    expect((await api.obter(IND1, p.id)).motivoRecusa).toBe('Cliente sem renda comprovada')
    expect((await falha(api.recusar(ADMIN, p.id)))?.status).toBe(409)
    const q = await propor(IND1, { clienteId: c }); expect((await api.recusar(ADMIN, q.id)).motivoRecusa).toBeNull()
  })
  it('o indicador cancela a própria pendente; a de outro é 404; admin e outros perfis 403; depois de respondida 409', async () => {
    const c = await cliente(); const p = await propor(IND1, { clienteId: c })
    expect((await falha(api.cancelar(IND2, p.id)))?.status).toBe(404)
    for (const s of [ADMIN, VEND, COBR]) expect((await falha(api.cancelar(s, p.id)))?.status).toBe(403)
    expect((await api.cancelar(IND1, p.id)).status).toBe('CANCELADA')
    expect((await falha(api.cancelar(IND1, p.id)))?.status).toBe(409)
    expect((await falha(api.aceitar(ADMIN, p.id)))?.status).toBe(409)
    const q = await propor(IND1, { clienteId: c }); await api.aceitar(ADMIN, q.id)
    expect((await falha(api.cancelar(IND1, q.id)))?.codigo).toBe('PROPOSTA_JA_RESPONDIDA')
  })
})
