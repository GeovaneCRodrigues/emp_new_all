import { beforeEach, describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { criarCaixaFake } from './caixa.fake'
import type { CaixaApi } from './caixa'
import { ErroApi } from './clientes'
import { criarClientesFake } from './clientes.fake'
import { criarEmprestimosFake, type EmprestimosFake } from './emprestimos.fake'
import { criarEstoqueFake, type EstoqueFake } from './estoque.fake'
import { criarIndicadoresFake } from './indicadores.fake'
import { criarRecebimentosFake } from './recebimentos.fake'
import type { RecebimentosApi } from './recebimentos'
import type { RelatoriosApi } from './relatorios'
import { criarRelatoriosFake } from './relatorios.fake'
import { criarRepassesFake } from './repasses.fake'
import type { RepassesApi } from './repasses'
import { criarVendasFake, type VendasFake } from './vendas.fake'

// Mesmas regras de back/tests/relatorios.test.ts: a demonstração tem de se comportar como o backend. O "hoje" da demonstração é 08/10/2026.
const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const OUTROS: Sessao[] = [{ perfil: 'VENDEDOR', usuarioId: 2 }, { perfil: 'COBRADOR', usuarioId: 3 }, { perfil: 'INDICADOR', indicadorId: 1 }]
const HOJE = '2026-10-08'
const soma = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100

let api: RelatoriosApi, caixa: CaixaApi, vendas: VendasFake, estoque: EstoqueFake, emprestimos: EmprestimosFake, recebimentos: RecebimentosApi, repasses: RepassesApi
beforeEach(() => {
  estoque = criarEstoqueFake()
  const indicadores = criarIndicadoresFake()
  const clientes = criarClientesFake()
  vendas = criarVendasFake({ estoque, indicadores, clientes })
  emprestimos = criarEmprestimosFake({ clientes, indicadores })
  recebimentos = criarRecebimentosFake(vendas, emprestimos)
  repasses = criarRepassesFake({ vendas, emprestimos, indicadores, hoje: HOJE })
  caixa = criarCaixaFake({ vendas, emprestimos, estoque, repasses })
  api = criarRelatoriosFake({ vendas, emprestimos, estoque, caixa, repasses })
})
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)

describe('relatórios (demonstração)', () => {
  it('só o administrador vê', async () => {
    for (const s of OUTROS) expect((await falha(api.ver(s)))?.status, s.perfil).toBe(403)
  })
  it('seis meses de lucro e sete de controle, terminando em outubro de 2026', async () => {
    const r = await api.ver(ADMIN)
    expect(r.hoje).toBe(HOJE)
    expect(r.resumo.meses).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
    expect(r.controleMensal.map((m) => m.mes)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01'])
  })
  it('o lucro de todos os meses fecha com o lucro de iPhones + empréstimos', async () => {
    const r = await api.ver(ADMIN)
    // a demonstração tem recebimentos antes de maio? se tiver, o total dos 6 meses é menor ou igual
    expect(soma(r.resumo.lucroPorMes)).toBeLessThanOrEqual(soma([r.resumo.lucroIphones, r.resumo.lucroEmprestimos]) + 0.01)
    expect(r.investimentoELucro.lucro).toEqual(r.resumo.lucroPorMes)
  })
  it('o caixa é o saldo do Caixa e o patrimônio é o que tem menos o que deve', async () => {
    const r = await api.ver(ADMIN)
    expect(r.balancete.caixa).toBe((await caixa.ver(ADMIN)).saldo)
    expect(r.balancete.patrimonio).toBe(Math.round((r.balancete.ativo - r.balancete.passivo) * 100) / 100)
    expect(r.balancete.aportes).toBe(100000) // o saldo de abertura da demonstração
  })
  it('estoque: só os aparelhos disponíveis, pelo custo com extras', async () => {
    const r = await api.ver(ADMIN)
    const lista = (await estoque.listar(ADMIN, { limite: 100 })).itens.filter((a) => a.estado === 'DISPONIVEL')
    expect(r.balancete.estoque).toBe(soma(lista.map((a) => (a.custo ?? 0) + (a.extras ?? 0))))
    expect(r.capital.noEstoque).toBe(r.balancete.estoque)
  })
  it('empréstimo novo entra no capital colocado do mês e na rua; o recebimento devolve o capital antes de dar lucro', async () => {
    const antes = await api.ver(ADMIN)
    const e = await emprestimos.criar(ADMIN, { clienteId: 3, capital: 1000, modalidade: 'PARCELADO', taxa: 50, parcelas: 2, periodicidade: 'MENSAL', primeiroVencimento: '2026-10-09' } as never)
    let r = await api.ver(ADMIN)
    expect(r.capital.colocadoPorMes[5]).toBe(soma([antes.capital.colocadoPorMes[5], 1000]))
    expect(r.capital.emprestimosNaRua).toBe(soma([antes.capital.emprestimosNaRua, 1000]))
    // 750 da 1ª parcela: ainda é capital voltando (750 < 1000), lucro não muda
    await recebimentos.registrar(ADMIN, 'EMPRESTIMO', e.id, { parcela: 1, valor: 750, forma: 'PIX' })
    r = await api.ver(ADMIN)
    expect(r.resumo.lucroEmprestimos).toBe(antes.resumo.lucroEmprestimos)
    expect(r.capital.emprestimosNaRua).toBe(soma([antes.capital.emprestimosNaRua, 250]))
    // a 2ª parcela (750): passa 500 do capital, e tudo isso é lucro do dono (sem indicador)
    await recebimentos.registrar(ADMIN, 'EMPRESTIMO', e.id, { parcela: 2, valor: 750, forma: 'PIX' })
    r = await api.ver(ADMIN)
    expect(r.resumo.lucroEmprestimos).toBe(soma([antes.resumo.lucroEmprestimos, 500]))
    expect(r.resumo.lucroPorMes[5]).toBe(soma([antes.resumo.lucroPorMes[5], 500]))
  })
  it('recibo desfeito não conta: o lucro e o recebido voltam ao que eram', async () => {
    const antes = await api.ver(ADMIN)
    const e = await emprestimos.criar(ADMIN, { clienteId: 3, capital: 1000, modalidade: 'PARCELADO', taxa: 50, parcelas: 2, periodicidade: 'MENSAL', primeiroVencimento: '2026-10-09' } as never)
    await recebimentos.registrar(ADMIN, 'EMPRESTIMO', e.id, { parcela: 1, valor: 750, forma: 'PIX' })
    const r = await recebimentos.registrar(ADMIN, 'EMPRESTIMO', e.id, { parcela: 2, valor: 750, forma: 'PIX' })
    expect((await api.ver(ADMIN)).investimentoELucro.recebido[5]).toBe(soma([antes.investimentoELucro.recebido[5], 1500]))
    await recebimentos.desfazer(ADMIN, r.recibo.id)
    const depois = await api.ver(ADMIN)
    expect(depois.investimentoELucro.recebido[5]).toBe(soma([antes.investimentoELucro.recebido[5], 750]))
    expect(depois.resumo.lucroEmprestimos).toBe(antes.resumo.lucroEmprestimos)
  })
  it('a entrada da venda conta como dinheiro recebido no mês da venda', async () => {
    const antes = await api.ver(ADMIN)
    const a = await estoque.criar(ADMIN, { modelo: 'iPhone 13', gb: 128, cor: 'Preto', preco: 3000, custo: 2000 })
    await vendas.criar(ADMIN, { aparelhoId: a.id, clienteId: 3, preco: 3000, entrada: 600, parcelas: 4, diaVencimento: 10 })
    const r = await api.ver(ADMIN)
    expect(r.investimentoELucro.recebido[5]).toBe(soma([antes.investimentoELucro.recebido[5], 600]))
    expect(r.investimentoELucro.investido[5]).toBe(soma([antes.investimentoELucro.investido[5], 2000]))
  })
  it('retirada diminui o "você colocou"; aporte aumenta; despesa não mexe nele', async () => {
    await caixa.lancar(ADMIN, { tipo: 'APORTE', valor: 5000 }); await caixa.lancar(ADMIN, { tipo: 'RETIRADA', valor: 1200 }); await caixa.lancar(ADMIN, { tipo: 'DESPESA', valor: 300, obs: 'internet' })
    expect((await api.ver(ADMIN)).balancete.aportes).toBe(100000 + 5000 - 1200)
  })
  it('venda retomada sai das contas e o aparelho volta ao estoque', async () => {
    const atrasada = vendas._interno.registros.find((r) => vendas._interno.calcular(r, 'ADMIN').status === 'ATIVA' && r.parcelas.some((p) => p.vencimento < HOJE && p.valor - p.pago - p.desconto > 0.009))
    expect(atrasada, 'a demonstração precisa ter uma venda atrasada').toBeDefined()
    const com = await api.ver(ADMIN)
    await vendas.retomar(ADMIN, atrasada!.id, {})
    const sem = await api.ver(ADMIN)
    expect(sem.investimentoELucro.iphones.investido).toBe(soma([com.investimentoELucro.iphones.investido, -atrasada!.investido]))
    expect(sem.balancete.estoque).toBeGreaterThan(com.balancete.estoque)
  })
})
