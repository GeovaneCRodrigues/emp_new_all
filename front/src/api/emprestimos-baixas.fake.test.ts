import { beforeEach, describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { ErroApi } from './clientes'
import { criarClientesFake } from './clientes.fake'
import type { EmprestimosApi } from './emprestimos'
import { criarEmprestimosFake } from './emprestimos.fake'
import { criarAprovacoesFake, criarFechamentosFake } from './equipe.fake'
import { criarEstoqueFake } from './estoque.fake'
import { criarIndicadoresFake } from './indicadores.fake'
import type { EntradaRecebimento, RecebimentosApi } from './recebimentos'
import { criarRecebimentosFake } from './recebimentos.fake'
import type { FechamentosApi } from './fechamentos'
import { criarVendasFake } from './vendas.fake'

// Mesmos cenários de back/tests/emprestimos-baixas.test.ts. Demonstração: hoje é 08/10/2026.
// Cobrador 3 (Diego): carteira Fernanda(3), Carlos(4), Ana Paula(6), João(8). Cliente 5 (Mariana) é do vendedor.
const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const VEND: Sessao = { perfil: 'VENDEDOR', usuarioId: 2 }
const COBR: Sessao = { perfil: 'COBRADOR', usuarioId: 3 }
const COBR2: Sessao = { perfil: 'COBRADOR', usuarioId: 77 }

let emp: EmprestimosApi
let rec: RecebimentosApi
let fech: FechamentosApi
beforeEach(() => {
  const clientes = criarClientesFake(); const indicadores = criarIndicadoresFake()
  const vendas = criarVendasFake({ estoque: criarEstoqueFake(), indicadores, clientes })
  const e = criarEmprestimosFake({ clientes, indicadores })
  emp = e; rec = criarRecebimentosFake(vendas, e); fech = criarFechamentosFake(vendas); void criarAprovacoesFake
})
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)
const emprestimo = async (corpo: object = {}, cliente = 3) => (await emp.criar(ADMIN, { clienteId: cliente, modalidade: 'PARCELADO', capital: 5000, taxa: 10, parcelas: 6, ...corpo } as never)).id
const juros = () => emprestimo({ modalidade: 'JUROS', capital: 3000, taxa: 12, parcelas: 3 })
const receber = (s: Sessao, e: number, corpo: Partial<EntradaRecebimento> = {}) => rec.registrar(s, 'EMPRESTIMO', e, { forma: 'PIX', parcela: 1, valor: 1333.34, ...corpo })
const valores = async (e: number) => (await emp.obter(ADMIN, e)).parcelas.map((p) => p.valor)

describe('parcelado', () => {
  it('quem pode: admin e cobrador da carteira; vendedor 403; outra carteira e inexistente 404', async () => {
    const e = await emprestimo()
    expect((await falha(receber(VEND, e)))?.status).toBe(403)
    expect((await falha(receber(COBR2, e)))?.status).toBe(404)
    expect((await falha(receber(ADMIN, 999999)))?.status).toBe(404)
    expect((await receber(COBR, e)).recibo.valor).toBe(1333.34)
  })
  it('quita a parcela e devolve recibo de empréstimo com o texto do WhatsApp', async () => {
    const e = await emprestimo()
    const r = await receber(ADMIN, e)
    expect(r.efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }])
    expect(r.recibo).toMatchObject({ operacao: 'EMPRESTIMO', aparelho: 'Empréstimo parcelado', referencia: 'parcela 1/6', faltaDepois: 6666.7, restantes: 5 })
    expect(r.recibo.mensagem).toContain('referente à parcela 1/6 do empréstimo parcelado.')
    expect(await emp.obter(ADMIN, e)).toMatchObject({ recebido: 1333.34, falta: 6666.7 })
  })
  it('quitar todas fecha o empréstimo; pagar de novo é 409', async () => {
    const e = await emprestimo({ parcelas: 2 })
    expect((await receber(ADMIN, e, { parcela: 1, valor: 3000 })).quitada).toBe(false)
    expect((await receber(ADMIN, e, { parcela: 2, valor: 3000 })).quitada).toBe(true)
    expect((await emp.obter(ADMIN, e)).status).toBe('QUITADA')
    expect((await falha(receber(ADMIN, e, { parcela: 2, valor: 10 })))?.codigo).toBe('PARCELA_PAGA')
  })
  it('pagou menos: o resto fica devendo; desconto direto só o admin; pedir desconto não existe em empréstimo', async () => {
    const e = await emprestimo()
    expect((await receber(COBR, e, { valor: 500, resto: 'FICA', novoVencimento: '2026-10-20' })).efeitos).toEqual([{ tipo: 'FICA', numero: 1, resta: 833.34, vencimento: '2026-10-20' }])
    const e2 = await emprestimo()
    expect((await falha(receber(COBR, e2, { valor: 500, resto: 'DESCONTO' })))?.status).toBe(403)
    expect((await receber(ADMIN, e2, { valor: 1000, resto: 'DESCONTO' })).efeitos).toEqual([{ tipo: 'DESCONTO', numero: 1, valor: 333.34 }])
    const e3 = await emprestimo()
    expect((await falha(receber(COBR, e3, { valor: 500, resto: 'FICA', novoVencimento: '2026-10-20', pedirDesconto: { motivo: 'sem dinheiro' } })))?.status).toBe(400)
    expect((await emp.obter(ADMIN, e3)).recebido).toBe(0)
  })
  it('pagou a mais abate as próximas; passar da dívida é 400', async () => {
    const e = await emprestimo()
    expect((await receber(ADMIN, e, { valor: 2000 })).efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }, { tipo: 'ABATE', numero: 2, valor: 666.66 }])
    expect((await falha(receber(ADMIN, await emprestimo(), { valor: 8000.05 })))?.codigo).toBe('EXCEDE_DIVIDA')
  })
})

describe('só juros: o excedente amortiza o capital', () => {
  it('exemplo do Geovane: 1.000 na 1ª → 640 abatem o capital (2.360) e o juro seguinte vira 283,20', async () => {
    const e = await juros()
    const r = await receber(ADMIN, e, { valor: 1000 })
    expect(r.efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }, { tipo: 'AMORTIZA', valor: 640, capitalRestante: 2360 }])
    expect(r.recibo).toMatchObject({ valor: 1000, amortizacao: { valor: 640, capitalRestante: 2360 }, faltaDepois: 2926.4 })
    expect(r.recibo.mensagem).toContain('abateu o capital')
    expect(await valores(e)).toEqual([360, 283.2, 2643.2])
    expect(await emp.obter(ADMIN, e)).toMatchObject({ total: 3926.4, recebido: 1000, falta: 2926.4, lucroTotal: 926.4, capitalAberto: 2360 })
    expect(await emp.obter(COBR, e)).not.toHaveProperty('capitalAberto')
  })
  it('juro + todo o capital (3.360) quita o empréstimo: parcelas seguintes zeradas', async () => {
    const e = await juros()
    expect((await receber(ADMIN, e, { valor: 3360 })).quitada).toBe(true)
    expect(await valores(e)).toEqual([360, 0, 0])
    expect(await emp.obter(ADMIN, e)).toMatchObject({ falta: 0, status: 'QUITADA', total: 3360, recebido: 3360 })
  })
  it('passar de juro + capital é 400; excedente na última parcela também', async () => {
    const e = await juros()
    expect((await falha(receber(ADMIN, e, { valor: 3360.01 })))?.codigo).toBe('EXCEDE_DIVIDA')
    expect((await falha(receber(ADMIN, e, { parcela: 3, valor: 3400 })))?.codigo).toBe('EXCEDE_DIVIDA')
    expect(await valores(e)).toEqual([360, 360, 3360])
  })
  it('amortiza em duas vezes usando o capital que sobrou', async () => {
    const e = await juros()
    await receber(ADMIN, e, { valor: 1000 })
    expect((await receber(ADMIN, e, { parcela: 2, valor: 1283.2 })).efeitos).toEqual([{ tipo: 'QUITA', numero: 2 }, { tipo: 'AMORTIZA', valor: 1000, capitalRestante: 1360 }])
    expect(await valores(e)).toEqual([360, 283.2, 1523.2])
  })
  it('DESFAZER devolve as parcelas recalculadas, o capital e o status', async () => {
    const e = await juros()
    const r = await receber(ADMIN, e, { valor: 3360 })
    await rec.desfazer(ADMIN, r.recibo.id)
    expect(await valores(e)).toEqual([360, 360, 3360])
    expect(await emp.obter(ADMIN, e)).toMatchObject({ status: 'ATIVA', recebido: 0, falta: 4080, capitalAberto: 3000 })
    expect((await receber(ADMIN, e, { valor: 1000 })).recibo.amortizacao).toEqual({ valor: 640, capitalRestante: 2360 })
  })
  it('desfazer a 2ª amortização volta ao estado da 1ª, não ao original', async () => {
    const e = await juros()
    await receber(ADMIN, e, { valor: 1000 })
    const r2 = await receber(ADMIN, e, { parcela: 2, valor: 1283.2 })
    await rec.desfazer(ADMIN, r2.recibo.id)
    expect(await valores(e)).toEqual([360, 283.2, 2643.2])
    expect((await emp.obter(ADMIN, e)).capitalAberto).toBe(2360)
  })
})

describe('desfazer, recibo, pagamentos e cobranças', () => {
  it('só o último se desfaz; cobrador só o dele de hoje', async () => {
    const e = await emprestimo()
    const a = (await receber(ADMIN, e, { parcela: 1 })).recibo.id
    const b = (await receber(ADMIN, e, { parcela: 2 })).recibo.id
    expect((await falha(rec.desfazer(ADMIN, a)))?.codigo).toBe('NAO_E_O_ULTIMO')
    await rec.desfazer(ADMIN, b)
    expect((await falha(rec.desfazer(ADMIN, b)))?.codigo).toBe('JA_DESFEITO')
    const e2 = await emprestimo()
    const c = (await receber(COBR, e2)).recibo.id
    expect((await falha(rec.desfazer(COBR2, c)))?.status).toBe(404)
    await rec.desfazer(COBR, c)
  })
  it('recibo e pagamentos respeitam o escopo', async () => {
    const e = await emprestimo()
    const rid = (await receber(COBR, e)).recibo.id
    expect((await rec.recibo(COBR, rid)).operacao).toBe('EMPRESTIMO')
    expect((await falha(rec.recibo(COBR2, rid)))?.status).toBe(404)
    expect((await rec.pagamentos(ADMIN, 'EMPRESTIMO', e)).map((p) => p.referencia)).toEqual(['parcela 1/6'])
    expect((await falha(rec.pagamentos(COBR2, 'EMPRESTIMO', e)))?.status).toBe(404)
  })
  it('cobranças trazem empréstimos com tipo; filtro por tipo; inventado é 400; carteira respeitada', async () => {
    const a = await emprestimo({}, 3); const b = await emprestimo({}, 5)
    const todas = await rec.cobrancas(ADMIN, { aba: 'hoje', limite: 100 })
    expect(todas.itens.some((c) => c.tipo === 'VENDA')).toBe(true)
    const so = await rec.cobrancas(ADMIN, { aba: 'proximas', tipo: 'EMPRESTIMO', limite: 100 })
    expect(so.itens.length).toBeGreaterThan(0)
    expect(so.itens.every((c) => c.tipo === 'EMPRESTIMO')).toBe(true)
    expect((await falha(rec.cobrancas(ADMIN, { tipo: 'XYZ' as never })))?.status).toBe(400)
    const dele = (await rec.cobrancas(COBR, { aba: 'proximas', tipo: 'EMPRESTIMO', limite: 100 })).itens.map((c) => c.operacaoId)
    expect(dele).toContain(a); expect(dele).not.toContain(b)
  })
  it('o recebimento de empréstimo entra no caixa e no fechamento do cobrador; dia fechado bloqueia', async () => {
    const e = await emprestimo()
    await receber(COBR, e, { forma: 'DINHEIRO' })
    expect(await fech.hoje(COBR)).toMatchObject({ dinheiro: 1333.34 })
    const f = await fech.fechar(COBR)
    expect(f.totalDinheiro).toBe(1333.34)
    expect((await falha(receber(COBR, e, { parcela: 2 })))?.codigo).toBe('DIA_FECHADO')
    expect((await receber(ADMIN, e, { parcela: 2 })).recibo.valor).toBe(1333.34)
  })
})
