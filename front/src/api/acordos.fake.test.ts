import { beforeEach, describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { ErroApi } from './clientes'
import { criarClientesFake } from './clientes.fake'
import type { AcordosApi } from './acordos'
import { criarAcordosFake } from './acordos.fake'
import type { AprovacoesApi } from './aprovacoes'
import type { EmprestimosApi } from './emprestimos'
import { criarEmprestimosFake } from './emprestimos.fake'
import { criarAprovacoesFake } from './equipe.fake'
import { criarEstoqueFake } from './estoque.fake'
import { criarIndicadoresFake } from './indicadores.fake'
import type { RecebimentosApi } from './recebimentos'
import { criarRecebimentosFake } from './recebimentos.fake'
import { criarVendasFake, type VendasFake } from './vendas.fake'

// Mesmos cenários de back/tests/acordos.test.ts. Demonstração: hoje é 08/10/2026.
// Cobrador 3 (Diego): carteira Fernanda(3), Carlos(4), Ana Paula(6), João(8). A venda do Carlos tem parcelas atrasadas.
const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const VEND: Sessao = { perfil: 'VENDEDOR', usuarioId: 2 }
const COBR: Sessao = { perfil: 'COBRADOR', usuarioId: 3 }
const COBR2: Sessao = { perfil: 'COBRADOR', usuarioId: 77 }
const PRIMEIRA = '2026-12-01'

let vendas: VendasFake
let emp: EmprestimosApi
let acordos: AcordosApi
let apr: AprovacoesApi
let rec: RecebimentosApi
let carlos: number
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)

beforeEach(async () => {
  const clientes = criarClientesFake(); const indicadores = criarIndicadoresFake()
  vendas = criarVendasFake({ estoque: criarEstoqueFake(), indicadores, clientes })
  const e = criarEmprestimosFake({ clientes, indicadores })
  emp = e; acordos = criarAcordosFake(vendas, e); apr = criarAprovacoesFake(vendas, e, acordos as never); rec = criarRecebimentosFake(vendas, e)
  carlos = (await vendas.listar(ADMIN, { limite: 100 })).itens.find((v) => v.cliente.nome.startsWith('Carlos') && v.status === 'ATIVA' && v.atrasadas > 0)!.id
  // limpa o pedido de retomada de demonstração para não atrapalhar os cenários
  for (const p of (await apr.listar(ADMIN, { status: 'PENDENTE', limite: 100 })).itens) await apr.recusar(ADMIN, p.id)
})
const ficha = (id: number) => vendas.obter(ADMIN, id)
const saldoDe = async (id: number) => (await ficha(id)).falta
const fazer = (s: Sessao, id: number, e: object = {}) => acordos.fazer(s, 'VENDA', id, { valorTotal: 3000, parcelas: 4, primeiraParcela: PRIMEIRA, ...e } as never)
const pedir = (s: Sessao, id: number, e: object = {}) => apr.pedirAcordo(s, { alvo: 'VENDA', operacaoId: id, valorTotal: 3000, parcelas: 4, primeiraParcela: PRIMEIRA, motivo: 'Cliente pediu pra renegociar', ...e } as never)
const jurosEmp = async () => (await emp.criar(ADMIN, { clienteId: 3, modalidade: 'JUROS', capital: 3000, taxa: 12, parcelas: 3 })).id

describe('administrador faz o acordo (venda)', () => {
  it('só o administrador; inexistente 404', async () => {
    for (const s of [COBR, VEND]) expect((await falha(fazer(s, carlos)))?.status).toBe(403)
    expect((await falha(fazer(ADMIN, 999999)))?.status).toBe(404)
  })
  it.each([
    ['valor zero', { valorTotal: 0 }], ['parcelas zero', { parcelas: 0 }], ['parcelas demais', { parcelas: 121 }], ['1ª data que já passou', { primeiraParcela: '2026-10-07' }],
    ['1ª data inválida', { primeiraParcela: 'amanhã' }], ['motivo enorme', { motivo: 'x'.repeat(501) }],
  ])('recusa %s (400) e não mexe em nada', async (_n, m) => {
    const antes = await saldoDe(carlos)
    expect((await falha(fazer(ADMIN, carlos, m)))?.status).toBe(400)
    expect(await saldoDe(carlos)).toBe(antes)
  })
  it('FAZ O ACORDO: encerra as abertas, as novas continuam a numeração, a soma fecha, o recebido não muda', async () => {
    const antes = await ficha(carlos)
    const abertas = antes.parcelas.filter((p) => p.falta > 0).length
    const r = await fazer(ADMIN, carlos, { valorTotal: 3000.01, parcelas: 3 })
    expect(r).toMatchObject({ saldoAntes: antes.falta, valorTotal: 3000.01, nParcelas: 3, parcelasEncerradas: abertas })
    const f = await ficha(carlos)
    expect(f).toMatchObject({ recebido: antes.recebido, falta: 3000.01, atrasadas: 0, status: 'ATIVA' })
    expect(f.parcelas.filter((p) => p.acordo === 'ENCERRADA')).toHaveLength(abertas)
    const novas = f.parcelas.filter((p) => p.acordo === 'NOVA')
    expect(novas.map((p) => p.valor)).toEqual([1000, 1000, 1000.01])
    expect(novas.map((p) => p.numero)).toEqual([antes.nParcelas + 1, antes.nParcelas + 2, antes.nParcelas + 3])
    expect(novas.map((p) => p.vencimento)).toEqual(['2026-12-01', '2027-01-01', '2027-02-01'])
    expect(f.nParcelas).toBe(antes.nParcelas + 3)
  })
  it('abaixo do saldo vira desconto (lucro cai); acima vira juros do acordo (lucro sobe)', async () => {
    const saldo = await saldoDe(carlos)
    const lucro = (await ficha(carlos)).lucroTotal!
    await fazer(ADMIN, carlos, { valorTotal: saldo - 100 })
    expect((await ficha(carlos)).lucroTotal).toBe(Math.round((lucro - 100) * 100) / 100)
  })
  it('sai das cobranças atrasadas; segundo acordo substitui o primeiro e só um fica ATIVO', async () => {
    const atrasadasDele = async () => (await rec.cobrancas(ADMIN, { aba: 'atrasadas', tipo: 'VENDA', limite: 100 })).itens.filter((c) => c.operacaoId === carlos).length
    expect(await atrasadasDele()).toBeGreaterThan(0)
    const a1 = await fazer(ADMIN, carlos)
    expect(await atrasadasDele()).toBe(0)
    const a2 = await fazer(ADMIN, carlos, { valorTotal: 2000, parcelas: 2 })
    expect(a2.substituiuAcordoId).toBe(a1.acordoId)
    const h = await acordos.listar(ADMIN, 'VENDA', carlos)
    expect(h.map((a) => [a.id, a.status])).toEqual([[a2.acordoId, 'ATIVO'], [a1.acordoId, 'SUBSTITUIDO']])
    expect(await saldoDe(carlos)).toBe(2000)
  })
  it('sem saldo → SEM_SALDO; venda retomada → VENDA_ENCERRADA', async () => {
    const outra = (await vendas.listar(ADMIN, { status: 'QUITADA', limite: 100 })).itens[0]
    if (outra) expect((await falha(fazer(ADMIN, outra.id)))?.codigo).toBe('SEM_SALDO')
    await vendas.retomar(ADMIN, carlos)
    expect((await falha(fazer(ADMIN, carlos)))?.codigo).toBe('VENDA_ENCERRADA')
  })
  it('histórico: cobrador da carteira vê; outra carteira e vendedor não', async () => {
    await fazer(ADMIN, carlos)
    expect(await acordos.listar(COBR, 'VENDA', carlos)).toHaveLength(1)
    expect((await falha(acordos.listar(COBR2, 'VENDA', carlos)))?.status).toBe(404)
    expect((await falha(acordos.listar(VEND, 'VENDA', carlos)))?.status).toBe(403)
  })
})

describe('depois do acordo', () => {
  it('recebe as parcelas novas; as encerradas dão PARCELA_PAGA; quitar o acordo fecha a venda', async () => {
    await fazer(ADMIN, carlos, { valorTotal: 1000, parcelas: 2 })
    const f = await ficha(carlos)
    const enc = f.parcelas.find((p) => p.acordo === 'ENCERRADA')!
    expect((await falha(rec.registrar(ADMIN, 'VENDA', carlos, { parcela: enc.numero, valor: 10, forma: 'PIX' })))?.codigo).toBe('PARCELA_PAGA')
    for (const n of f.parcelas.filter((p) => p.acordo === 'NOVA').map((p) => p.numero)) await rec.registrar(ADMIN, 'VENDA', carlos, { parcela: n, valor: 500, forma: 'PIX' })
    expect((await ficha(carlos)).status).toBe('QUITADA')
  })
  it('desfazer pagamento de ANTES numa parcela encerrada é 409; depois do acordo funciona', async () => {
    const f0 = await ficha(carlos)
    const parc = f0.parcelas.find((p) => p.falta > 100)!
    const antigo = await rec.registrar(ADMIN, 'VENDA', carlos, { parcela: parc.numero, valor: 100, forma: 'PIX', resto: 'FICA', novoVencimento: '2026-10-20' })
    await fazer(ADMIN, carlos)
    expect((await falha(rec.desfazer(ADMIN, antigo.recibo.id)))?.codigo).toBe('ACORDO_FEITO')
    const nova = (await ficha(carlos)).parcelas.find((p) => p.acordo === 'NOVA')!
    const novo = await rec.registrar(ADMIN, 'VENDA', carlos, { parcela: nova.numero, valor: nova.valor, forma: 'PIX' })
    await rec.desfazer(ADMIN, novo.recibo.id)
  })
  it('pedidos de desconto e de acordo que esperavam são recusados ("Acordo feito")', async () => {
    const desc = await apr.pedirDesconto(COBR, { alvo: 'VENDA', operacaoId: carlos, parcela: (await ficha(carlos)).parcelas.find((p) => p.falta > 10)!.numero, valor: 10, motivo: 'Cliente pediu' })
    const acc = await pedir(COBR, carlos)
    await fazer(ADMIN, carlos)
    const lista = (await apr.listar(ADMIN, { limite: 100 })).itens
    for (const id of [desc.id, acc.id]) expect(lista.find((x) => x.id === id)).toMatchObject({ status: 'RECUSADO', resposta: 'Acordo feito' })
  })
  it('só juros depois do acordo vira parcela comum: o excedente abate as próximas, NÃO o capital', async () => {
    const e = await jurosEmp()
    await acordos.fazer(ADMIN, 'EMPRESTIMO', e, { valorTotal: 3600, parcelas: 3, primeiraParcela: PRIMEIRA })
    const f = await emp.obter(ADMIN, e)
    expect(f.parcelas.map((p) => p.valor)).toEqual([0, 0, 0, 1200, 1200, 1200])
    const r = await rec.registrar(ADMIN, 'EMPRESTIMO', e, { parcela: 4, valor: 1500, forma: 'PIX' })
    expect(r.efeitos).toEqual([{ tipo: 'QUITA', numero: 4 }, { tipo: 'ABATE', numero: 5, valor: 300 }])
    expect(r.recibo.amortizacao).toBeNull()
  })
})

describe('cobrador pede o acordo', () => {
  it('só o cobrador da carteira; outra carteira 404; validações 400; SEM_SALDO/encerrada 409', async () => {
    for (const s of [ADMIN, VEND]) expect((await falha(pedir(s, carlos)))?.status).toBe(403)
    expect((await falha(pedir(COBR2, carlos)))?.status).toBe(404)
    expect((await falha(pedir(COBR, carlos, { motivo: 'ab' })))?.status).toBe(400)
    expect((await falha(pedir(COBR, carlos, { parcelas: 0 })))?.status).toBe(400)
    expect((await falha(pedir(COBR, carlos, { primeiraParcela: '2026-10-07' })))?.status).toBe(400)
  })
  it('nasce PENDENTE com a proposta e o saldo da hora; um pendente por operação; vale para empréstimo', async () => {
    const saldo = await saldoDe(carlos)
    const r = await pedir(COBR, carlos)
    expect(r).toMatchObject({ tipo: 'ACORDO', status: 'PENDENTE', alvo: 'VENDA', parcela: null, valor: 3000, acordo: { parcelas: 4, primeiraParcela: PRIMEIRA, saldoNoPedido: saldo } })
    expect((await falha(pedir(COBR, carlos)))?.codigo).toBe('PEDIDO_JA_EXISTE')
    expect(await saldoDe(carlos)).toBe(saldo)
    const e = await jurosEmp()
    expect(await apr.pedirAcordo(COBR, { alvo: 'EMPRESTIMO', operacaoId: e, valorTotal: 3600, parcelas: 3, primeiraParcela: PRIMEIRA, motivo: 'Cliente pediu' })).toMatchObject({ alvo: 'EMPRESTIMO', acordo: { saldoNoPedido: 4080 } })
  })
  it('APROVAR faz o acordo com a proposta do cobrador e liga o pedido; responder de novo é 409', async () => {
    const p = await pedir(COBR, carlos)
    expect((await falha(apr.aprovar(COBR, p.id)))?.status).toBe(403)
    expect(await apr.aprovar(ADMIN, p.id)).toMatchObject({ status: 'APROVADO' })
    const f = await ficha(carlos)
    expect(f.parcelas.filter((x) => x.acordo === 'NOVA').map((x) => x.valor)).toEqual([750, 750, 750, 750])
    expect((await acordos.listar(ADMIN, 'VENDA', carlos))[0]).toMatchObject({ aprovacaoId: p.id, motivo: 'Cliente pediu pra renegociar' })
    expect((await falha(apr.aprovar(ADMIN, p.id)))?.codigo).toBe('PEDIDO_JA_RESPONDIDO')
  })
  it('RECUSAR não mexe em nada; o cliente pagou depois do pedido: aprovar é 409 (desatualizado)', async () => {
    const p = await pedir(COBR, carlos)
    await apr.recusar(ADMIN, p.id, 'Valor baixo')
    expect((await ficha(carlos)).parcelas.every((x) => x.acordo === null)).toBe(true)
    const p2 = await pedir(COBR, carlos)
    const parc = (await ficha(carlos)).parcelas.find((x) => x.falta > 10)!
    await rec.registrar(ADMIN, 'VENDA', carlos, { parcela: parc.numero, valor: 10, forma: 'PIX', resto: 'FICA', novoVencimento: '2026-10-20' })
    expect((await falha(apr.aprovar(ADMIN, p2.id)))?.codigo).toBe('PEDIDO_DESATUALIZADO')
    expect((await ficha(carlos)).parcelas.every((x) => x.acordo === null)).toBe(true)
  })
  it('retomar a venda recusa o pedido de acordo que esperava', async () => {
    const p = await pedir(COBR, carlos)
    await vendas.retomar(ADMIN, carlos)
    expect((await apr.listar(ADMIN, { limite: 100 })).itens.find((x) => x.id === p.id)).toMatchObject({ status: 'RECUSADO', resposta: 'Venda retomada' })
  })
})
