import { beforeEach, describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { ErroApi } from './clientes'
import { criarClientesFake } from './clientes.fake'
import type { EmprestimosApi } from './emprestimos'
import { criarEmprestimosFake } from './emprestimos.fake'
import { criarIndicadoresFake } from './indicadores.fake'

// Mesmos cenários de back/tests/emprestimos.test.ts. Demonstração: hoje é 08/10/2026.
// Cobrador 3 (Diego): carteira Fernanda(3), Carlos(4), Ana Paula(6), João(8). Cliente 1 (Juliana) é do vendedor 2.
const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const VEND: Sessao = { perfil: 'VENDEDOR', usuarioId: 2 }
const COBR: Sessao = { perfil: 'COBRADOR', usuarioId: 3 }
const COBR2: Sessao = { perfil: 'COBRADOR', usuarioId: 77 }
const IND: Sessao = { perfil: 'INDICADOR', indicadorId: 1 }

let api: EmprestimosApi
beforeEach(() => { api = criarEmprestimosFake({ clientes: criarClientesFake(), indicadores: criarIndicadoresFake() }) })
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)
const emprestar = (s: Sessao, e: object = {}) => api.criar(s, { clienteId: 3, modalidade: 'PARCELADO', capital: 5000, taxa: 60, parcelas: 6, ...e } as never)

describe('criar', () => {
  it('só o administrador empresta', async () => {
    for (const s of [VEND, COBR, IND]) expect((await falha(emprestar(s)))?.status).toBe(403)
  })
  it('refaz as parcelas: 5.000 a 60% no total em 6x são 6 de 1.333,34, vencendo mês a mês no dia de hoje', async () => {
    const e = await emprestar(ADMIN)
    expect(e).toMatchObject({ modalidade: 'PARCELADO', dataEmprestimo: '2026-10-08', capital: 5000, taxa: 60, periodicidade: 'MENSAL', nParcelas: 6, valorParcela: 1333.34, total: 8000.04, recebido: 0, falta: 8000.04, status: 'ATIVA', lucroTotal: 3000.04, capitalDeVolta: 0 })
    expect(e.parcelas.map((p) => p.vencimento)).toEqual(['2026-11-08', '2026-12-08', '2027-01-08', '2027-02-08', '2027-03-08', '2027-04-08'])
  })
  it('ignora totais e data mandados pela tela', async () => {
    expect(await emprestar(ADMIN, { total: 1, valorParcela: 1 })).toMatchObject({ total: 8000.04, dataEmprestimo: '2026-10-08' })
  })
  it('congela o % do indicador na criação', async () => {
    const e = await emprestar(ADMIN, { indicadorId: 1 })
    expect(e.indicador?.nome).toBe('Roberto Indicações')
    expect(e.percentualIndicador).toBe(0.5)
    expect(e.parteIndicador).toBe(1500.02)
  })
  it.each([
    ['cliente como texto', { clienteId: '1' }], ['modalidade inventada', { modalidade: 'SEMANAL' }], ['capital zero', { capital: 0 }], ['capital negativo', { capital: -10 }],
    ['capital como texto', { capital: '5000' }], ['taxa zero', { taxa: 0 }], ['taxa acima de 999', { taxa: 1000 }], ['só juros com taxa acima de 100', { modalidade: 'JUROS', taxa: 101 }], ['zero parcelas', { parcelas: 0 }],
    ['parcelas quebradas', { parcelas: 2.5 }], ['parcelas demais', { parcelas: 121 }], ['observações enormes', { observacoes: 'x'.repeat(501) }],
  ])('recusa %s (400)', async (_n, m) => { expect((await falha(emprestar(ADMIN, m)))?.status).toBe(400) })
  it('só juros: 360, 360 e 3.360 (capital na última parcela)', async () => {
    const e = await emprestar(ADMIN, { modalidade: 'JUROS', capital: 3000, taxa: 12, parcelas: 3 })
    expect(e).toMatchObject({ modalidade: 'JUROS', nParcelas: 3, valorParcela: 360, total: 4080, lucroTotal: 1080 })
    expect(e.parcelas.map((p) => p.valor)).toEqual([360, 360, 3360])
  })
  it('diária: parcela por dia útil (sem domingo) com a taxa do período todo', async () => {
    const e = await emprestar(ADMIN, { modalidade: 'DIARIA', capital: 1000, taxa: 20, parcelas: 24 })
    expect(e).toMatchObject({ modalidade: 'DIARIA', nParcelas: 24, valorParcela: 50, total: 1200, lucroTotal: 200 })
    expect(e.parcelas.every((p) => new Date(p.vencimento + 'T12:00:00Z').getUTCDay() !== 0)).toBe(true)
  })
  it('frequência semanal com 1º vencimento escolhido: 15/10, 22/10, 29/10…', async () => {
    const e = await emprestar(ADMIN, { periodicidade: 'SEMANAL', primeiroVencimento: '2026-10-15', parcelas: 4, capital: 1000, taxa: 30 })
    expect(e).toMatchObject({ periodicidade: 'SEMANAL', valorParcela: 325, total: 1300 })
    expect(e.parcelas.map((p) => p.vencimento)).toEqual(['2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05'])
  })
  it('sem 1º vencimento: um período depois (quinzenal → +15 dias); data do empréstimo no passado parte dela', async () => {
    expect((await emprestar(ADMIN, { periodicidade: 'QUINZENAL', parcelas: 2 })).parcelas.map((p) => p.vencimento)).toEqual(['2026-10-23', '2026-11-07'])
    const e = await emprestar(ADMIN, { dataEmprestimo: '2026-08-10', parcelas: 3 })
    expect(e.parcelas.map((p) => p.vencimento)).toEqual(['2026-09-10', '2026-10-10', '2026-11-10'])
    expect(e.atrasadas).toBe(1)
  })
  it.each([
    ['frequência inventada', { periodicidade: 'ANUAL' }], ['diária com frequência mensal', { modalidade: 'DIARIA', periodicidade: 'MENSAL', taxa: 20 }], ['parcelado com frequência diária', { periodicidade: 'DIARIA' }],
    ['data do empréstimo no futuro', { dataEmprestimo: '2026-10-09' }], ['data inválida', { dataEmprestimo: '2026-02-31' }], ['1º vencimento antes do empréstimo', { primeiroVencimento: '2026-10-07' }],
    ['1º vencimento daqui a mais de um ano', { primeiroVencimento: '2027-10-10' }],
  ])('recusa %s (400)', async (_n, m) => { expect((await falha(emprestar(ADMIN, m)))?.status).toBe(400) })
  it('cliente inexistente é 404', async () => { expect((await falha(emprestar(ADMIN, { clienteId: 999999 })))?.status).toBe(404) })
})

describe('ler e escopo', () => {
  it('o admin vê todos e o cobrador só os da carteira; o vendedor, 403 (o indicador lê só os dele: indicador-leitura.fake.test.ts)', async () => {
    await emprestar(ADMIN, { clienteId: 3 }); await emprestar(ADMIN, { clienteId: 5 }) // Mariana é do vendedor
    const nomes = (await api.listar(COBR, { limite: 100 })).itens.map((e) => e.cliente.id)
    expect(nomes.every((c) => [3, 4, 6, 8].includes(c))).toBe(true)
    expect((await api.listar(COBR2, { limite: 100 })).itens).toHaveLength(0)
    expect((await falha(api.listar(VEND, {})))?.status).toBe(403); expect((await falha(api.resumo(VEND)))?.status).toBe(403)
  })
  it('o cobrador não recebe capital, taxa, lucro nem indicador (os campos nem existem)', async () => {
    const e = (await api.listar(COBR, {})).itens[0]
    for (const campo of ['capital', 'taxa', 'lucroTotal', 'seuLucro', 'lucroRealizado', 'capitalDeVolta', 'percentualIndicador', 'parteIndicador', 'indicador']) expect(campo in e).toBe(false)
  })
  it('ficha: do escopo abre; de outra carteira, inexistente não', async () => {
    const novo = await emprestar(ADMIN, { clienteId: 5 })
    expect((await api.obter(ADMIN, novo.id)).id).toBe(novo.id)
    expect((await falha(api.obter(COBR, novo.id)))?.status).toBe(404)
    expect((await falha(api.obter(ADMIN, 999999)))?.status).toBe(404)
  })
  it('filtra por status (e recusa inventado), pagina, e mostra atraso', async () => {
    expect((await api.listar(ADMIN, { status: 'ATRASO', limite: 100 })).itens.every((e) => e.atrasadas > 0)).toBe(true)
    expect((await falha(api.listar(ADMIN, { status: 'XYZ' })))?.status).toBe(400)
    const p = await api.listar(ADMIN, { limite: 2, pagina: 1 })
    expect(p.itens).toHaveLength(2)
    expect(p.total).toBeGreaterThan(2)
  })
  it('o resumo soma a receber, capital na rua e lucro por vir; o cobrador vê só o a receber', async () => {
    const r = await api.resumo(ADMIN)
    expect(r.aReceber).toBeGreaterThan(0); expect(r.capitalNaRua).toBeGreaterThan(0); expect(r.lucroPorVir).toBeGreaterThan(0)
    expect(Object.keys(await api.resumo(COBR))).toEqual(['aReceber'])
  })
})

describe('busca (mesmas regras do backend)', () => {
  it('sem busca traz tudo; acha pelo cliente (sem acento/maiúscula) e pelo indicador', async () => {
    await emprestar(ADMIN)
    await emprestar(ADMIN, { clienteId: 4 })
    const tudo = (await api.listar(ADMIN, { limite: 100 })).total
    expect(tudo).toBeGreaterThanOrEqual(2)
    expect((await api.listar(ADMIN, { busca: '  ', limite: 100 })).total).toBe(tudo)
    const alvo = (await api.listar(ADMIN, { limite: 100 })).itens[0]
    const palavra = alvo.cliente.nome.split(' ')[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    const r = await api.listar(ADMIN, { busca: palavra, limite: 100 })
    expect(r.itens.some((e) => e.id === alvo.id)).toBe(true)
    expect(r.total).toBeLessThanOrEqual(tudo)
  })
  it('todas as palavras têm de aparecer; nada achado = lista vazia', async () => {
    await emprestar(ADMIN)
    expect(await api.listar(ADMIN, { busca: 'zzzxyz qwerty', limite: 100 })).toMatchObject({ itens: [], total: 0 })
  })
  it('combina com o status e o total acompanha', async () => {
    const e = await emprestar(ADMIN)
    const nome = e.cliente.nome.split(' ')[0]
    expect((await api.listar(ADMIN, { busca: nome, status: 'ATIVA', limite: 100 })).itens.some((x) => x.id === e.id)).toBe(true)
    expect((await api.listar(ADMIN, { busca: nome, status: 'QUITADA', limite: 100 })).itens.some((x) => x.id === e.id)).toBe(false)
  })
})
