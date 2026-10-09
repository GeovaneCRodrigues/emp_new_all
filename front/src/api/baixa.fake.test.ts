import { beforeEach, describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { ErroApi } from './clientes'
import { criarClientesFake } from './clientes.fake'
import { criarEmprestimosFake } from './emprestimos.fake'
import { criarAprovacoesFake } from './equipe.fake'
import { criarEstoqueFake } from './estoque.fake'
import { criarIndicadoresFake } from './indicadores.fake'
import type { AprovacoesApi } from './aprovacoes'
import { criarRecebimentosFake } from './recebimentos.fake'
import { criarVendasFake } from './vendas.fake'

// Mesmos cenários de back/tests/baixa.test.ts: a demonstração tem de se comportar como o backend.
const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const COBR: Sessao = { perfil: 'COBRADOR', usuarioId: 3 }
const VEND: Sessao = { perfil: 'VENDEDOR', usuarioId: 2 }
const IND1: Sessao = { perfil: 'INDICADOR', indicadorId: 1 }
const IND2: Sessao = { perfil: 'INDICADOR', indicadorId: 2 }
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)

let apr: AprovacoesApi
let vendas: ReturnType<typeof criarVendasFake>
let emprestimos: ReturnType<typeof criarEmprestimosFake>
let rec: ReturnType<typeof criarRecebimentosFake>
let estoque: ReturnType<typeof criarEstoqueFake>
beforeEach(() => {
  const clientes = criarClientesFake(); estoque = criarEstoqueFake(); const indicadores = criarIndicadoresFake()
  vendas = criarVendasFake({ estoque, indicadores, clientes })
  emprestimos = criarEmprestimosFake({ clientes, indicadores })
  rec = criarRecebimentosFake(vendas, emprestimos)
  apr = criarAprovacoesFake(vendas, emprestimos, undefined, rec)
})
/** Venda nova do indicador 1 (entrada 600, 4x). */
async function venda(indicadorId: number | null = 1) {
  const ap = (await estoque.listar(ADMIN, { estado: 'DISPONIVEL', limite: 1 })).itens[0]
  return vendas.criar(ADMIN, { aparelhoId: ap.id, clienteId: 3, preco: ap.preco, entrada: 600, parcelas: 4, diaVencimento: 10, indicadorId })
}
const avisar = (s: Sessao, op: number, e: object = {}) => apr.pedirBaixa(s, { alvo: 'VENDA', operacaoId: op, parcela: 1, valor: 1, forma: 'PIX', ...e } as never)
const pendente = async (op: number, parcela = 1) => (await rec.cobrancas(ADMIN, { aba: 'proximas', limite: 100 })).itens.find((l) => l.tipo === 'VENDA' && l.operacaoId === op && l.parcela === parcela)

describe('o indicador avisa', () => {
  it('só o indicador avisa (403 admin, cobrador e vendedor)', async () => {
    const v = await venda()
    for (const s of [ADMIN, COBR, VEND]) expect((await falha(avisar(s, v.id, { valor: v.valorParcela })))?.status).toBe(403)
    expect((await apr.listar(ADMIN, {})).itens.some((p) => p.tipo === 'BAIXA')).toBe(false)
  })
  it('nasce PENDENTE com tudo o que a loja precisa, NÃO dá baixa e a parcela aparece com o aviso', async () => {
    const v = await venda()
    const p = await avisar(IND1, v.id, { valor: v.valorParcela, comprovante: 'E2E123', motivo: 'paguei na mão' })
    expect(p).toMatchObject({ tipo: 'BAIXA', status: 'PENDENTE', operacaoId: v.id, parcela: 1, valor: v.valorParcela, baixa: { forma: 'PIX', data: '2026-10-08', comprovante: 'E2E123' }, motivo: 'paguei na mão' })
    expect((await vendas.obter(ADMIN, v.id)).parcelas[0].pago).toBe(0)
    const l = await pendente(v.id)
    expect(l?.baixaPendente).toMatchObject({ valor: v.valorParcela }); expect(l?.falta).toBe(v.valorParcela)
  })
  it('de operação de outro indicador, sem indicador ou inexistente: 404', async () => {
    const dela = await venda(2); const sem = await venda(null)
    for (const id of [dela.id, sem.id, 999999]) expect((await falha(avisar(IND1, id)))?.status).toBe(404)
  })
  it.each([
    ['sem valor', { valor: undefined }], ['valor zero', { valor: 0 }], ['valor negativo', { valor: -1 }], ['valor gigante', { valor: 1e9 }], ['acima do que falta na parcela', { valor: 1e7 }],
    ['sem forma', { forma: undefined }], ['forma inválida', { forma: 'BOLETO' }], ['parcela zero', { parcela: 0 }], ['parcela inexistente', { parcela: 99 }],
    ['data inválida', { data: '2026-02-31' }], ['data futura', { data: '2026-10-09' }], ['comprovante enorme', { comprovante: 'x'.repeat(121) }], ['observação enorme', { motivo: 'x'.repeat(501) }], ['alvo inválido', { alvo: 'TROCA' }],
  ])('recusa %s (400/404) e não grava nada', async (_n, m) => {
    const v = await venda()
    const e = { alvo: 'VENDA', operacaoId: v.id, parcela: 1, valor: v.valorParcela, forma: 'PIX', ...m } as Record<string, unknown>
    for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k]
    expect([400, 404]).toContain((await falha(apr.pedirBaixa(IND1, e as never)))?.status)
    expect((await apr.listar(ADMIN, {})).itens.some((p) => p.tipo === 'BAIXA')).toBe(false)
  })
  it('um aviso esperando por parcela (409); parcela já paga e venda retomada (409)', async () => {
    const v = await venda()
    await avisar(IND1, v.id, { valor: v.valorParcela })
    expect((await falha(avisar(IND1, v.id, { valor: 1 })))?.codigo).toBe('PEDIDO_JA_EXISTE')
    await rec.registrar(ADMIN, 'VENDA', v.id, { forma: 'PIX', parcela: 2, valor: v.valorParcela })
    expect((await falha(avisar(IND1, v.id, { parcela: 2, valor: 1 })))?.codigo).toBe('PARCELA_PAGA')
  })
  it('vale para empréstimo também', async () => {
    const e = (await emprestimos.listar(IND1, { limite: 1 })).itens[0]
    const p = await apr.pedirBaixa(IND1, { alvo: 'EMPRESTIMO', operacaoId: e.id, parcela: e.parcelas.find((x) => x.falta > 0)!.numero, valor: 1, forma: 'DINHEIRO' })
    expect(p).toMatchObject({ alvo: 'EMPRESTIMO', operacaoId: e.id })
  })
  it('o indicador vê só os próprios avisos; o admin vê todos; o indicador não responde (403)', async () => {
    const a = await venda(1); const b = await venda(2)
    const pa = await avisar(IND1, a.id, { valor: a.valorParcela }); await avisar(IND2, b.id, { valor: b.valorParcela })
    expect((await apr.listar(IND1, { limite: 100 })).itens.map((p) => p.id)).toEqual([pa.id])
    expect((await apr.listar(ADMIN, { limite: 100 })).itens.filter((p) => p.tipo === 'BAIXA')).toHaveLength(2)
    for (const s of [IND1, IND2, COBR]) { expect((await falha(apr.aprovar(s, pa.id)))?.status).toBe(403); expect((await falha(apr.recusar(s, pa.id)))?.status).toBe(403) }
  })
})

describe('a loja confirma ou recusa', () => {
  it('CONFIRMAR registra o recebimento (recebido pelo indicador), quita a parcela, devolve o recibo e fecha o aviso', async () => {
    const v = await venda(); const p = await avisar(IND1, v.id, { valor: v.valorParcela })
    const r = await apr.aprovar(ADMIN, p.id)
    expect(r).toMatchObject({ status: 'APROVADO', respondidoPor: 'Geovane Cataneo' })
    expect(r.recibo).toMatchObject({ valor: v.valorParcela, forma: 'PIX' })
    expect((await vendas.obter(ADMIN, v.id)).parcelas[0].falta).toBe(0)
    expect((await rec.pagamentos(ADMIN, 'VENDA', v.id))[0].recebidoPor).toContain('Roberto')
    expect((await rec.cobrancas(ADMIN, { aba: 'proximas', limite: 100 })).itens.some((l) => l.operacaoId === v.id && l.parcela === 1)).toBe(false)
  })
  it('confirmar duas vezes: 409 e não paga em dobro', async () => {
    const v = await venda(); const p = await avisar(IND1, v.id, { valor: v.valorParcela })
    await apr.aprovar(ADMIN, p.id)
    expect((await falha(apr.aprovar(ADMIN, p.id)))?.codigo).toBe('PEDIDO_JA_RESPONDIDO')
    expect((await rec.pagamentos(ADMIN, 'VENDA', v.id)).filter((x) => x.tipo === 'PARCELA')).toHaveLength(1)
  })
  it('veio menos que a parcela: sem decidir, 400 e o aviso segue esperando; decidindo (fica devendo + data), vira recebimento parcial', async () => {
    const v = await venda(); const p = await avisar(IND1, v.id, { valor: 500 })
    expect((await falha(apr.aprovar(ADMIN, p.id)))?.status).toBe(400)
    expect((await apr.listar(ADMIN, { status: 'PENDENTE' })).itens.some((x) => x.id === p.id)).toBe(true)
    const r = await apr.aprovar(ADMIN, p.id, { resto: 'FICA', novoVencimento: '2026-10-25' })
    expect(r.recibo?.valor).toBe(500)
  })
  it('a parcela foi paga por outro caminho antes: o aviso é recusado sozinho', async () => {
    const v = await venda(); const p = await avisar(IND1, v.id, { valor: v.valorParcela })
    await rec.registrar(ADMIN, 'VENDA', v.id, { forma: 'DINHEIRO', parcela: 1, valor: v.valorParcela })
    const depois = (await apr.listar(ADMIN, { limite: 100 })).itens.find((x) => x.id === p.id)!
    expect(depois.status).toBe('RECUSADO'); expect(depois.resposta).toContain('já lançou')
    expect((await falha(apr.aprovar(ADMIN, p.id)))?.status).toBe(409)
  })
  it('RECUSAR deixa a parcela em aberto, sem recebimento, e o indicador vê o motivo; depois pode avisar de novo', async () => {
    const v = await venda(); const p = await avisar(IND1, v.id, { valor: v.valorParcela })
    await apr.recusar(ADMIN, p.id, 'O cliente disse que não pagou')
    expect((await pendente(v.id))?.baixaPendente).toBeNull()
    expect((await apr.listar(IND1, { limite: 100 })).itens[0]).toMatchObject({ status: 'RECUSADO', resposta: 'O cliente disse que não pagou' })
    expect(await avisar(IND1, v.id, { valor: v.valorParcela })).toMatchObject({ status: 'PENDENTE' })
  })
  it('o indicador pede desconto de operação dele (a de outro é 404) e a loja aprova', async () => {
    const v = await venda(); const dela = await venda(2)
    const d = await apr.pedirDesconto(IND1, { alvo: 'VENDA', operacaoId: v.id, parcela: 1, valor: 50, motivo: 'cliente pediu um desconto' })
    expect(d.tipo).toBe('DESCONTO')
    expect((await falha(apr.pedirDesconto(IND1, { alvo: 'VENDA', operacaoId: dela.id, parcela: 1, valor: 50, motivo: 'abc' })))?.status).toBe(404)
    await apr.aprovar(ADMIN, d.id)
    expect((await vendas.obter(ADMIN, v.id)).parcelas[0].desconto).toBe(50)
  })
  it('retomada e acordo continuam só do cobrador (403 para o indicador)', async () => {
    const v = await venda()
    expect((await falha(apr.pedirRetomada(IND1, { operacaoId: v.id, motivo: 'abc' })))?.status).toBe(403)
    expect((await falha(apr.pedirAcordo(IND1, { alvo: 'VENDA', operacaoId: v.id, valorTotal: 100, parcelas: 2, primeiraParcela: '2026-11-01', motivo: 'abc' })))?.status).toBe(403)
  })
})
