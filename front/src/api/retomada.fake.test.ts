import { beforeEach, describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { ErroApi } from './clientes'
import { criarClientesFake } from './clientes.fake'
import type { AprovacoesApi } from './aprovacoes'
import { criarEmprestimosFake } from './emprestimos.fake'
import { criarAprovacoesFake } from './equipe.fake'
import { criarEstoqueFake, type EstoqueFake } from './estoque.fake'
import { criarIndicadoresFake } from './indicadores.fake'
import type { RecebimentosApi } from './recebimentos'
import { criarRecebimentosFake } from './recebimentos.fake'
import { criarVendasFake, type VendasFake } from './vendas.fake'

// Mesmos cenários de back/tests/retomada.test.ts. Demonstração: hoje é 08/10/2026.
// Cobrador 3 (Diego): carteira Fernanda(3), Carlos(4), Ana Paula(6), João(8). O Carlos (venda 4) tem parcelas atrasadas.
const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const VEND: Sessao = { perfil: 'VENDEDOR', usuarioId: 2 }
const COBR: Sessao = { perfil: 'COBRADOR', usuarioId: 3 }
const COBR2: Sessao = { perfil: 'COBRADOR', usuarioId: 77 }

let vendas: VendasFake
let estoque: EstoqueFake
let apr: AprovacoesApi
let rec: RecebimentosApi
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)
let atrasada: number // venda do Carlos, com parcela atrasada
let emDia: number // venda sem atraso

beforeEach(async () => {
  const clientes = criarClientesFake(); const indicadores = criarIndicadoresFake()
  estoque = criarEstoqueFake()
  vendas = criarVendasFake({ estoque, indicadores, clientes })
  const emp = criarEmprestimosFake({ clientes, indicadores })
  apr = criarAprovacoesFake(vendas, emp); rec = criarRecebimentosFake(vendas, emp)
  const todas = (await vendas.listar(ADMIN, { limite: 100 })).itens
  atrasada = todas.find((v) => v.cliente.nome.startsWith('Carlos') && v.status === 'ATIVA' && v.atrasadas > 0)!.id
  emDia = todas.find((v) => v.status === 'ATIVA' && v.atrasadas === 0)!.id
})
const aparelhoDe = async (v: number) => (await vendas.obter(ADMIN, v)).aparelho.id
const estadoBem = async (id: number) => (await estoque.obter(ADMIN, id)).estado
const pedir = (s: Sessao, v: number, m = '2 parcelas atrasadas e não atende') => apr.pedirRetomada(s, { operacaoId: v, motivo: m })

describe('administrador retoma direto', () => {
  it('só o administrador; sem atraso e venda que não está em andamento são 409', async () => {
    for (const s of [COBR, VEND]) expect((await falha(vendas.retomar(s, atrasada)))?.status).toBe(403)
    expect((await falha(vendas.retomar(ADMIN, emDia)))?.codigo).toBe('SEM_ATRASO')
    expect((await falha(vendas.retomar(ADMIN, 999999)))?.status).toBe(404)
  })
  it('retoma: a venda vira RETOMADA, o aparelho volta ao estoque disponível, o dinheiro já recebido fica', async () => {
    const bem = await aparelhoDe(atrasada)
    const antes = await vendas.obter(ADMIN, atrasada)
    const r = await vendas.retomar(ADMIN, atrasada, { motivo: '  Cliente sumiu  ' })
    expect(r).toMatchObject({ status: 'RETOMADA', retomada: { motivo: 'Cliente sumiu' }, recebido: antes.recebido })
    expect(await estadoBem(bem)).toBe('DISPONIVEL')
    expect((await falha(vendas.retomar(ADMIN, atrasada)))?.codigo).toBe('VENDA_NAO_RETOMAVEL')
  })
  it('sai do "a receber" e das cobranças, aparece em Retomadas e não recebe mais pagamento', async () => {
    const antes = (await vendas.resumo(ADMIN)).aReceber
    await vendas.retomar(ADMIN, atrasada)
    expect((await vendas.resumo(ADMIN)).aReceber).toBeLessThan(antes)
    expect((await rec.cobrancas(ADMIN, { aba: 'atrasadas', tipo: 'VENDA', limite: 100 })).itens.some((c) => c.operacaoId === atrasada)).toBe(false)
    expect((await vendas.listar(ADMIN, { status: 'RETOMADA', limite: 100 })).itens.some((v) => v.id === atrasada)).toBe(true)
    expect((await falha(rec.registrar(ADMIN, 'VENDA', atrasada, { parcela: 1, valor: 10, forma: 'PIX' })))?.codigo).toBe('VENDA_ENCERRADA')
  })
  it('motivo enorme é 400', async () => {
    expect((await falha(vendas.retomar(ADMIN, atrasada, { motivo: 'x'.repeat(501) })))?.status).toBe(400)
  })
  it('pedidos que esperavam sobre a venda são recusados sozinhos ("Venda retomada")', async () => {
    const ret = (await apr.listar(ADMIN, { status: 'PENDENTE', limite: 100 })).itens.find((p) => p.tipo === 'RETOMADA')!
    await vendas.retomar(ADMIN, ret.operacaoId)
    const depois = (await apr.listar(ADMIN, { limite: 100 })).itens.find((p) => p.id === ret.id)!
    expect(depois).toMatchObject({ status: 'RECUSADO', resposta: 'Venda retomada' })
    expect((await falha(apr.aprovar(ADMIN, ret.id)))?.codigo).toBe('PEDIDO_JA_RESPONDIDO')
  })
})

describe('cobrador pede a retomada', () => {
  it('só o cobrador da carteira; outra carteira e inexistente 404; sem atraso 409; motivo inválido 400', async () => {
    expect((await falha(pedir(ADMIN, atrasada)))?.status).toBe(403)
    expect((await falha(pedir(VEND, atrasada)))?.status).toBe(403)
    expect((await falha(pedir(COBR2, atrasada)))?.status).toBe(404)
    expect((await falha(pedir(COBR, 999999)))?.status).toBe(404)
    expect((await falha(pedir(COBR, emDia)))?.status).toBe(404) // a venda em dia não é da carteira dele...
    expect((await falha(pedir(COBR, atrasada, 'ab')))?.status).toBe(400)
  })
  it('nasce PENDENTE sem parcela, com o em aberto; um pendente por venda; recusar libera um novo pedido', async () => {
    // o pedido de demonstração do Carlos já está na fila: recuso e peço de novo
    const antigo = (await apr.listar(ADMIN, { status: 'PENDENTE', limite: 100 })).itens.find((p) => p.tipo === 'RETOMADA')!
    expect((await falha(pedir(COBR, antigo.operacaoId)))?.codigo).toBe('PEDIDO_JA_EXISTE')
    await apr.recusar(ADMIN, antigo.id, 'Vamos esperar')
    const novo = await pedir(COBR, antigo.operacaoId)
    expect(novo).toMatchObject({ tipo: 'RETOMADA', status: 'PENDENTE', parcela: null, alvo: 'VENDA', solicitante: { nome: 'Diego Ramos' } })
    expect(novo.valor).toBeGreaterThan(0)
  })
})

describe('administrador responde', () => {
  const pendente = async () => (await apr.listar(ADMIN, { status: 'PENDENTE', limite: 100 })).itens.find((p) => p.tipo === 'RETOMADA')!
  it('APROVAR retoma de verdade e o motivo do cobrador vai para a venda', async () => {
    const p = await pendente()
    const bem = await aparelhoDe(p.operacaoId)
    expect((await falha(apr.aprovar(COBR, p.id)))?.status).toBe(403)
    expect(await apr.aprovar(ADMIN, p.id)).toMatchObject({ status: 'APROVADO' })
    expect((await vendas.obter(ADMIN, p.operacaoId)).status).toBe('RETOMADA')
    expect(await estadoBem(bem)).toBe('DISPONIVEL')
    expect((await falha(apr.aprovar(ADMIN, p.id)))?.codigo).toBe('PEDIDO_JA_RESPONDIDO')
  })
  it('RECUSAR não mexe na venda nem no aparelho', async () => {
    const p = await pendente()
    const bem = await aparelhoDe(p.operacaoId)
    expect(await apr.recusar(ADMIN, p.id, 'Pagou')).toMatchObject({ status: 'RECUSADO', resposta: 'Pagou' })
    expect((await vendas.obter(ADMIN, p.operacaoId)).status).toBe('ATIVA')
    expect(await estadoBem(bem)).toBe('VENDIDO')
  })
  it('o cliente pagou o atraso depois do pedido: aprovar é 409 (desatualizado) e a venda segue ativa', async () => {
    const p = await pendente()
    const v = await vendas.obter(ADMIN, p.operacaoId)
    for (const parc of v.parcelas.filter((x) => x.vencimento < '2026-10-08' && x.falta > 0)) await rec.registrar(ADMIN, 'VENDA', p.operacaoId, { parcela: parc.numero, valor: parc.falta, forma: 'PIX' })
    expect((await vendas.obter(ADMIN, p.operacaoId)).atrasadas).toBe(0)
    expect((await falha(apr.aprovar(ADMIN, p.id)))?.codigo).toBe('PEDIDO_DESATUALIZADO')
    expect((await vendas.obter(ADMIN, p.operacaoId)).status).toBe('ATIVA')
  })
})
