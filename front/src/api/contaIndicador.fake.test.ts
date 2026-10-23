import { beforeEach, describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { ErroApi } from './clientes'
import { criarContaIndicadorFake, type ContaIndicadorFake } from './contaIndicador.fake'
import { criarClientesFake } from './clientes.fake'
import { criarEmprestimosFake } from './emprestimos.fake'
import { criarEstoqueFake } from './estoque.fake'
import { criarIndicadoresFake } from './indicadores.fake'
import { criarVendasFake, type VendasFake } from './vendas.fake'

const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const COBR: Sessao = { perfil: 'COBRADOR', usuarioId: 3 }
const IND1: Sessao = { perfil: 'INDICADOR', indicadorId: 1 }
const IND2: Sessao = { perfil: 'INDICADOR', indicadorId: 2 }
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)

let conta: ContaIndicadorFake
let vendas: VendasFake
let emp: ReturnType<typeof criarEmprestimosFake>
beforeEach(() => {
  const clientes = criarClientesFake(); const indicadores = criarIndicadoresFake()
  vendas = criarVendasFake({ estoque: criarEstoqueFake(), indicadores, clientes })
  emp = criarEmprestimosFake({ clientes, indicadores })
  conta = criarContaIndicadorFake({ indicadores, hoje: () => '2026-10-08', transacoes: () => vendas._interno.transacoes, emprestimos: () => emp._interno.registros })
})

describe('conta corrente do indicador (demonstração)', () => {
  it('nasce com o indicador 1 devendo 800 (cobrou 1.200, enviou 400) e os outros zerados', async () => {
    const lista = await conta.saldos(ADMIN)
    expect(lista.find((s) => s.indicador.id === 1)!.saldo).toBe(800)
    expect(lista.filter((s) => s.indicador.id !== 1).every((s) => s.saldo === 0)).toBe(true)
    const c = await conta.ver(ADMIN, 1)
    expect(c).toMatchObject({ saldo: 800, cobrou: 1200, enviou: 400, emprestou: 0, total: 2 })
  })
  it('lançar envio baixa o saldo; acima do saldo vira crédito (negativo)', async () => {
    expect((await conta.lancarEnvio(ADMIN, 1, { valor: 300, comprovante: 'PIX1' })).saldo).toBe(500)
    expect((await conta.lancarEnvio(ADMIN, 1, { valor: 600 })).saldo).toBe(-100)
  })
  it('cobrou (transação marcada) e emprestou (empréstimo) entram no saldo e no extrato', async () => {
    const t = vendas._interno.transacoes.find((x) => !x.desfeita && x.data <= '2026-10-08')!
    t.cobradoPorIndicadorId = 2 // a loja confirmou uma baixa dizendo que o dinheiro ficou na conta da Carla
    await emp.criar(ADMIN, { clienteId: 3, modalidade: 'PARCELADO', capital: 1000, taxa: 30, parcelas: 2, saiuDaConta: { indicadorId: 2, valor: 200 } })
    const c = await conta.ver(ADMIN, 2)
    expect(c).toMatchObject({ saldo: t.valor - 200, cobrou: t.valor, emprestou: 200, total: 2 })
  })
  it.each([['valor zero', { valor: 0 }], ['valor negativo', { valor: -1 }], ['valor como texto', { valor: '100' }], ['sem valor', {}], ['data no futuro', { valor: 10, data: '2026-10-09' }], ['data inválida', { valor: 10, data: '2026-02-31' }], ['lado inventado', { valor: 10, lado: 'CARRO' }]])('envio com %s: 400', async (_n, e) => {
    expect((await falha(conta.lancarEnvio(ADMIN, 1, e as never)))?.status).toBe(400)
    expect((await conta.ver(ADMIN, 1)).enviou).toBe(400)
  })
  it('permissões: lançar só o administrador; indicador vê só a própria (a de outro é 404); cobrador 403; indicador inexistente 404', async () => {
    expect((await falha(conta.lancarEnvio(IND1, 1, { valor: 10 })))?.status).toBe(403)
    expect((await conta.ver(IND1, 1)).saldo).toBe(800)
    expect((await falha(conta.ver(IND2, 1)))?.status).toBe(404)
    expect((await falha(conta.ver(COBR, 1)))?.status).toBe(403)
    expect((await falha(conta.saldos(IND1)))?.status).toBe(403)
    expect((await falha(conta.ver(ADMIN, 999)))?.status).toBe(404)
    expect((await falha(conta.lancarEnvio(ADMIN, 999, { valor: 10 })))?.status).toBe(404)
  })
  it('paginação do extrato', async () => {
    for (let i = 0; i < 3; i++) await conta.lancarEnvio(ADMIN, 1, { valor: 10 + i })
    const c = await conta.ver(ADMIN, 1, { pagina: 2, limite: 2 })
    expect(c).toMatchObject({ total: 5, pagina: 2, limite: 2 })
    expect(c.itens).toHaveLength(2)
  })
})
