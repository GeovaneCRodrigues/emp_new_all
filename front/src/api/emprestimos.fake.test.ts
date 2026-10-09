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
const emprestar = (s: Sessao, e: object = {}) => api.criar(s, { clienteId: 3, modalidade: 'PARCELADO', capital: 5000, taxa: 10, parcelas: 6, ...e } as never)

describe('criar', () => {
  it('só o administrador empresta', async () => {
    for (const s of [VEND, COBR, IND]) expect((await falha(emprestar(s)))?.status).toBe(403)
  })
  it('refaz as parcelas: 5.000 a 10% em 6x são 6 de 1.333,34, vencendo mês a mês no dia de hoje', async () => {
    const e = await emprestar(ADMIN)
    expect(e).toMatchObject({ modalidade: 'PARCELADO', dataEmprestimo: '2026-10-08', capital: 5000, taxa: 10, nParcelas: 6, valorParcela: 1333.34, total: 8000.04, recebido: 0, falta: 8000.04, status: 'ATIVA', lucroTotal: 3000.04, capitalDeVolta: 0 })
    expect(e.parcelas.map((p) => p.vencimento)).toEqual(['2026-11-08', '2026-12-08', '2027-01-08', '2027-02-08', '2027-03-08', '2027-04-08'])
  })
  it('ignora totais e data mandados pela tela', async () => {
    expect(await emprestar(ADMIN, { total: 1, dataEmprestimo: '2020-01-01' })).toMatchObject({ total: 8000.04, dataEmprestimo: '2026-10-08' })
  })
  it('congela o % do indicador na criação', async () => {
    const e = await emprestar(ADMIN, { indicadorId: 1 })
    expect(e.indicador?.nome).toBe('Roberto Indicações')
    expect(e.percentualIndicador).toBe(0.5)
    expect(e.parteIndicador).toBe(1500.02)
  })
  it.each([
    ['cliente como texto', { clienteId: '1' }], ['modalidade inventada', { modalidade: 'SEMANAL' }], ['capital zero', { capital: 0 }], ['capital negativo', { capital: -10 }],
    ['capital como texto', { capital: '5000' }], ['taxa zero', { taxa: 0 }], ['taxa acima de 100', { taxa: 101 }], ['zero parcelas', { parcelas: 0 }],
    ['parcelas quebradas', { parcelas: 2.5 }], ['parcelas demais', { parcelas: 61 }], ['observações enormes', { observacoes: 'x'.repeat(501) }],
  ])('recusa %s (400)', async (_n, m) => { expect((await falha(emprestar(ADMIN, m)))?.status).toBe(400) })
  it('só juros: 360, 360 e 3.360 (capital na última parcela)', async () => {
    const e = await emprestar(ADMIN, { modalidade: 'JUROS', capital: 3000, taxa: 12, parcelas: 3 })
    expect(e).toMatchObject({ modalidade: 'JUROS', nParcelas: 3, valorParcela: 360, total: 4080, lucroTotal: 1080 })
    expect(e.parcelas.map((p) => p.valor)).toEqual([360, 360, 3360])
  })
  it('cliente inexistente é 404; DIARIA ainda não está liberada (400) e não cria nada', async () => {
    expect((await falha(emprestar(ADMIN, { clienteId: 999999 })))?.status).toBe(404)
    const antes = (await api.listar(ADMIN, { limite: 100 })).total
    for (const modalidade of ['DIARIA']) expect((await falha(emprestar(ADMIN, { modalidade })))?.status).toBe(400)
    expect((await api.listar(ADMIN, { limite: 100 })).total).toBe(antes)
  })
})

describe('ler e escopo', () => {
  it('o admin vê todos e o cobrador só os da carteira; vendedor e indicador, 403', async () => {
    await emprestar(ADMIN, { clienteId: 3 }); await emprestar(ADMIN, { clienteId: 5 }) // Mariana é do vendedor
    const nomes = (await api.listar(COBR, { limite: 100 })).itens.map((e) => e.cliente.id)
    expect(nomes.every((c) => [3, 4, 6, 8].includes(c))).toBe(true)
    expect((await api.listar(COBR2, { limite: 100 })).itens).toHaveLength(0)
    for (const s of [VEND, IND]) { expect((await falha(api.listar(s, {})))?.status).toBe(403); expect((await falha(api.resumo(s)))?.status).toBe(403) }
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
