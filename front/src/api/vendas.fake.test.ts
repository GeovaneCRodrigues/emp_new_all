import { beforeEach, describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { ErroApi } from './clientes'
import { criarClientesFake } from './clientes.fake'
import { criarEstoqueFake, type EstoqueFake } from './estoque.fake'
import { criarIndicadoresFake, type IndicadoresFake } from './indicadores.fake'
import type { EntradaVenda, VendasApi } from './vendas'
import { criarVendasFake } from './vendas.fake'

// Mesmos cenários de back/tests/vendas.test.ts: a demonstração tem de se comportar como o backend.
const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const VEND: Sessao = { perfil: 'VENDEDOR', usuarioId: 2 } // carteira: Juliana(1), Lucas(2), Mariana(5), Patrícia(9)
const COBR: Sessao = { perfil: 'COBRADOR', usuarioId: 3 }
const IND: Sessao = { perfil: 'INDICADOR', indicadorId: 1 }

let api: VendasApi
let estoque: EstoqueFake
let indicadores: IndicadoresFake
beforeEach(() => {
  const clientes = criarClientesFake()
  estoque = criarEstoqueFake()
  indicadores = criarIndicadoresFake()
  api = criarVendasFake({ estoque, indicadores, clientes })
})
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)

/** Cria um aparelho disponível novo e devolve o id. */
async function aparelho(preco = 7500, custo = 5000, extras = 0): Promise<number> {
  const a = await estoque.criar(ADMIN, { modelo: 'iPhone 16', gb: 128, cor: 'Preto', preco, custo, extras })
  return a.id
}
const base = async (extra: Partial<EntradaVenda> = {}): Promise<EntradaVenda> => ({ aparelhoId: await aparelho(), clienteId: 1, preco: 7500, entrada: 1500, parcelas: 10, diaVencimento: 10, ...extra })

describe('as contas do plano', () => {
  it('7.500 com 1.500 de entrada em 10x: 10 parcelas de 1.200, a partir do mês seguinte', async () => {
    const v = await api.criar(ADMIN, await base())
    expect(v).toMatchObject({ nParcelas: 10, valorParcela: 1200, total: 13500, recebido: 1500, falta: 12000, status: 'ATIVA', contrato: 'AGUARDANDO', jurosPct: 10, dataVenda: '2026-10-08' })
    expect(v.parcelas[0]).toMatchObject({ numero: 1, vencimento: '2026-11-10', valor: 1200 })
    expect(v.parcelas[9].vencimento).toBe('2027-08-10')
  })
  it.each([[6, 1600], [5, 1800]])('%ix → parcelas de %d', async (n, parc) => expect((await api.criar(ADMIN, await base({ parcelas: n }))).valorParcela).toBe(parc))
  it('o servidor ignora total, parcela e juros mandados pela tela', async () => {
    const v = await api.criar(ADMIN, { ...(await base()), total: 1, valorParcela: 1, jurosPct: 0 } as EntradaVenda)
    expect(v).toMatchObject({ valorParcela: 1200, total: 13500, jurosPct: 10 })
  })
  it('arredonda a parcela para cima e o cliente paga parcela × n', async () => {
    const v = await api.criar(ADMIN, await base({ preco: 2000, entrada: 1000, parcelas: 3 }))
    expect(v).toMatchObject({ valorParcela: 433.34, total: 2300.02 })
  })
  it('à vista: entrada = preço fecha quitada, sem parcelas', async () => {
    expect(await api.criar(ADMIN, await base({ entrada: 7500, parcelas: undefined, diaVencimento: undefined }))).toMatchObject({ nParcelas: 0, status: 'QUITADA', falta: 0 })
  })
})

describe('lucro e indicador (só o admin vê)', () => {
  it('sem indicador, tudo do dono; o custo do dia fica gravado', async () => {
    const v = await api.criar(ADMIN, await base({ aparelhoId: await aparelho(7500, 4800, 200) }))
    expect(v).toMatchObject({ custoNoDia: 5000, lucroTotal: 8500, seuLucro: 8500, parteIndicador: 0, indicador: null })
  })
  it('com indicador de 50%, o lucro se divide meio a meio', async () => {
    const v = await api.criar(ADMIN, await base({ indicadorId: 1 }))
    expect(v).toMatchObject({ percentualIndicador: 0.5, parteIndicador: 4250, seuLucro: 4250, indicador: { nome: 'Roberto Indicações' } })
  })
  it('indicador desativado ou inexistente é recusado', async () => {
    expect((await falha(api.criar(ADMIN, await base({ indicadorId: 99999 }))))?.status).toBe(400)
    await indicadores.atualizar(ADMIN, 1, { ativo: false })
    expect((await falha(api.criar(ADMIN, await base({ indicadorId: 1 }))))?.status).toBe(400)
  })
  it('depois da venda, o contador do indicador anda', async () => {
    const antes = (await indicadores.obter(ADMIN, 2)).operacoes
    await api.criar(ADMIN, await base({ indicadorId: 2 }))
    expect((await indicadores.obter(ADMIN, 2)).operacoes).toBe(antes + 1)
  })
})

describe('troca e estoque', () => {
  const troca = { modelo: 'iPhone 11', gb: 64, cor: 'Preto', bateria: 82, valor: 900 }
  it('a troca entra no estoque custando o que foi aceito (revenda = custo + 25%) e abate o parcelado', async () => {
    const v = await api.criar(ADMIN, await base({ troca, parcelas: 5 }))
    expect(v).toMatchObject({ troca: 900, valorParcela: 1530 }) // 5.100 × 1,5 ÷ 5
    const entrou = (await estoque.listar(ADMIN, { busca: 'iPhone 11', estado: 'DISPONIVEL', limite: 100 })).itens.find((a) => a.origem === 'TROCA')!
    expect(entrou).toMatchObject({ custo: 900, preco: 1125 })
  })
  it('a venda marca o aparelho como vendido', async () => {
    const id = await aparelho()
    await api.criar(ADMIN, await base({ aparelhoId: id }))
    expect((await estoque.obter(ADMIN, id)).estado).toBe('VENDIDO')
  })
  it('aparelho já vendido é 409', async () => {
    const corpo = await base()
    await api.criar(ADMIN, corpo)
    expect(await falha(api.criar(ADMIN, corpo))).toMatchObject({ status: 409, codigo: 'APARELHO_INDISPONIVEL' })
  })
  it('encomendado só vende para quem encomendou', async () => {
    const enc = (await estoque.listar(ADMIN, { estado: 'ENCOMENDADO' })).itens[0] // encomendado para a Patrícia (9)
    expect(await falha(api.criar(ADMIN, await base({ aparelhoId: enc.id, clienteId: 1 })))).toMatchObject({ status: 409, codigo: 'APARELHO_ENCOMENDADO' })
    expect((await api.criar(ADMIN, await base({ aparelhoId: enc.id, clienteId: 9 }))).cliente.nome).toBe('Patrícia Gomes')
  })
  it.each([['sem modelo', { modelo: '' }], ['bateria inválida', { bateria: 150 }], ['valor zero', { valor: 0 }], ['IMEI inválido', { imei: '123' }]])('recusa troca %s (400)', async (_n, m) => {
    expect((await falha(api.criar(ADMIN, await base({ troca: { ...troca, ...m } }))))?.status).toBe(400)
  })
})

describe('validações (400) e 404', () => {
  it.each([
    ['sem aparelho', { aparelhoId: undefined }], ['sem cliente', { clienteId: undefined }], ['entrada negativa', { entrada: -1 }], ['entrada + troca acima do preço', { entrada: 8000 }],
    ['mais parcelas que o máximo', { parcelas: 11 }], ['sem parcelas mas sobra a pagar', { parcelas: 0 }], ['sem dia de vencimento', { diaVencimento: undefined }], ['dia 32', { diaVencimento: 32 }],
    ['forma inventada', { formaEntrada: 'FIADO' }], ['preço zero', { preco: 0 }], ['parcelas quando não sobra nada', { entrada: 7500, parcelas: 3 }],
  ])('recusa %s', async (_n, m) => {
    const corpo = { ...(await base()), ...m } as Record<string, unknown>
    for (const k of Object.keys(corpo)) if (corpo[k] === undefined) delete corpo[k]
    expect((await falha(api.criar(ADMIN, corpo as unknown as EntradaVenda)))?.status).toBe(400)
  })
  it('aparelho e cliente inexistentes são 404', async () => {
    expect((await falha(api.criar(ADMIN, await base({ aparelhoId: 999999 }))))?.status).toBe(404)
    expect((await falha(api.criar(ADMIN, await base({ clienteId: 999999 }))))?.status).toBe(404)
  })
})

describe('permissões e vendedor', () => {
  it('cobrador e indicador não vendem (403); o indicador lê só as dele (indicador-leitura.fake.test.ts)', async () => {
    for (const s of [COBR, IND]) expect((await falha(api.criar(s, await base())))?.status).toBe(403)
    expect(await falha(api.listar(IND, {}))).toBeNull()
  })
  it('vende só para cliente da carteira dele (404 nos outros), em nome dele', async () => {
    expect((await falha(api.criar(VEND, await base({ clienteId: 3 }))))?.status).toBe(404) // Fernanda é do cobrador
    const v = await api.criar(VEND, await base({ clienteId: 1 }))
    expect(v.cliente.id).toBe(1)
  })
  it('não vende abaixo do preço de tabela, mas pode vender acima; o admin é livre', async () => {
    expect((await falha(api.criar(VEND, await base({ preco: 7000 }))))?.status).toBe(403)
    expect((await api.criar(VEND, await base({ preco: 8000 }))).precoAcordado).toBe(8000)
    expect((await api.criar(ADMIN, await base({ preco: 7000 }))).precoAcordado).toBe(7000)
  })
  it('não vende em nome de outro', async () => expect((await falha(api.criar(VEND, await base({ vendedorId: 3 }))))?.status).toBe(403))
  it('NUNCA recebe custo, lucro nem a parte do indicador (nem na lista, ficha ou resumo)', async () => {
    const v = await api.criar(VEND, await base({ clienteId: 1, indicadorId: 1 }))
    const corpos = [JSON.stringify(v), JSON.stringify(await api.listar(VEND, { limite: 100 })), JSON.stringify(await api.obter(VEND, v.id)), JSON.stringify(await api.resumo(VEND))]
    for (const c of corpos) expect(c).not.toMatch(/custoNoDia|lucro|seuLucro|parteIndicador|percentualIndicador|capitalDeVolta|capitalNaRua|investido/i)
    expect(v.total).toBeGreaterThan(0)
  })
})

describe('lista, ficha e resumo', () => {
  it('cada perfil só vê o seu escopo; fora dele é 404', async () => {
    const todas = await api.listar(ADMIN, { limite: 100 })
    const minhas = await api.listar(VEND, { limite: 100 })
    expect(minhas.total).toBeLessThan(todas.total)
    const alheia = todas.itens.find((x) => ![1, 2, 5, 9].includes(x.cliente.id))!
    expect((await falha(api.obter(VEND, alheia.id)))?.status).toBe(404)
    expect((await api.obter(ADMIN, alheia.id)).id).toBe(alheia.id)
  })
  it('filtra por status e recusa status inventado', async () => {
    expect((await api.listar(ADMIN, { status: 'ATRASO', limite: 100 })).itens.every((x) => x.atrasadas > 0 && x.status === 'ATIVA')).toBe(true)
    expect((await api.listar(ADMIN, { status: 'QUITADA', limite: 100 })).itens.every((x) => x.falta === 0)).toBe(true)
    expect((await falha(api.listar(ADMIN, { status: 'XYZ' })))?.status).toBe(400)
  })
  it('pagina e corta o limite em 100', async () => {
    const p = await api.listar(ADMIN, { limite: 3, pagina: 1 })
    expect(p.itens).toHaveLength(3)
    expect((await api.listar(ADMIN, { limite: 99999 })).limite).toBe(100)
  })
  it('resumo: admin recebe os 3 números; os outros só "a receber"', async () => {
    expect(Object.keys(await api.resumo(ADMIN)).sort()).toEqual(['aReceber', 'capitalNaRua', 'lucroPorVir'])
    expect(Object.keys(await api.resumo(VEND))).toEqual(['aReceber'])
  })
  it('a taxa de juros é lida por quem vende ou simula (admin, vendedor e indicador); o cobrador não', async () => {
    expect(await api.juros(VEND)).toEqual({ pct: 10, maxParcelas: 10 })
    expect(await api.juros(IND)).toEqual({ pct: 10, maxParcelas: 10 })
    expect((await falha(api.juros(COBR)))?.status).toBe(403)
  })
})
