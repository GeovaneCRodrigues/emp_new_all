import { beforeEach, describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { calcularRepasse } from '@/domain/repasseIndicador'
import { ErroApi } from './clientes'
import { criarEmprestimosFake } from './emprestimos.fake'
import { criarClientesFake } from './clientes.fake'
import { criarEstoqueFake } from './estoque.fake'
import { criarIndicadoresFake } from './indicadores.fake'
import type { RepassesApi } from './repasses'
import { criarRepassesFake } from './repasses.fake'
import { criarRecebimentosFake } from './recebimentos.fake'
import { criarVendasFake } from './vendas.fake'

// Mesmos cenários de back/tests/repasses.test.ts: a demonstração tem de se comportar como o backend.
const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)

let api: RepassesApi
let vendas: ReturnType<typeof criarVendasFake>
let recebimentos: ReturnType<typeof criarRecebimentosFake>
beforeEach(() => {
  const clientes = criarClientesFake(); const estoque = criarEstoqueFake(); const indicadores = criarIndicadoresFake()
  vendas = criarVendasFake({ estoque, indicadores, clientes })
  const emprestimos = criarEmprestimosFake({ clientes, indicadores })
  recebimentos = criarRecebimentosFake(vendas, emprestimos)
  api = criarRepassesFake({ vendas, emprestimos, indicadores, hoje: vendas._interno.hoje })
})
/** O primeiro indicador da demonstração que já tem dinheiro liberado. */
async function comSaldo() {
  const r = (await api.resumo(ADMIN)).find((x) => x.resumo.aPagar > 0)
  if (!r) throw new Error('a demonstração deveria ter um indicador com repasse liberado')
  return r
}

describe('quem pode ver e pagar', () => {
  it('resumo geral e pagamentos: só o administrador (403 para os outros)', async () => {
    for (const perfil of ['VENDEDOR', 'COBRADOR', 'INDICADOR'] as const) {
      const s = { perfil, usuarioId: 2, indicadorId: 1 } as Sessao
      expect((await falha(api.resumo(s)))?.status).toBe(403)
      expect((await falha(api.jaPagos(s)))?.status).toBe(403)
      expect((await falha(api.pagar(s, 1, { valor: 1, forma: 'PIX' })))?.status).toBe(403)
    }
  })
  it('o indicador vê só o repasse dele: o de outro é 404, igual a um que não existe', async () => {
    const eu: Sessao = { perfil: 'INDICADOR', indicadorId: 1 }
    expect((await api.detalhe(eu, 1)).indicador.id).toBe(1)
    expect((await falha(api.detalhe(eu, 2)))?.status).toBe(404)
    expect((await falha(api.detalhe(eu, 999)))?.status).toBe(404)
    expect((await falha(api.detalhe({ perfil: 'COBRADOR', usuarioId: 3 }, 1)))?.status).toBe(403)
  })
  it('indicador inexistente: 404', async () => {
    expect((await falha(api.detalhe(ADMIN, 999)))?.status).toBe(404)
    expect((await falha(api.pagar(ADMIN, 999, { valor: 1, forma: 'PIX' })))?.status).toBe(404)
  })
})

describe('o que está liberado', () => {
  it('o resumo bate com o cálculo puro sobre as operações do detalhe', async () => {
    const r = await comSaldo()
    const d = await api.detalhe(ADMIN, r.indicador.id)
    const de = calcularRepasse(d.operacoes.map(({ investido, parte: _p, liberado: _l, pagoNela: _n, aPagar: _a, vaiLiberar: _v, capitalVoltou: _c, ...o }) => ({ ...o, investido: investido ?? 0 })), d.resumo.pago)
    expect(d.resumo).toEqual({ liberado: de.liberado, pago: de.pago, aPagar: de.aPagar, vaiLiberar: de.vaiLiberar, pagoAMais: de.pagoAMais })
    expect(d.nOperacoes).toBe(d.operacoes.length)
  })
  it('o detalhe de um indicador nunca traz operação de outro', async () => {
    const todos = await api.resumo(ADMIN)
    const soma = (await Promise.all(todos.map((x) => api.detalhe(ADMIN, x.indicador.id)))).reduce((n, d) => n + d.operacoes.length, 0)
    expect(soma).toBe(todos.reduce((n, x) => n + x.nOperacoes, 0))
  })
  it('quitar uma venda libera o resto do repasse dela na hora', async () => {
    const todos = await api.resumo(ADMIN)
    let achou = false
    for (const x of todos) {
      const d = await api.detalhe(ADMIN, x.indicador.id)
      const op = d.operacoes.find((o) => o.tipo === 'VENDA' && o.status === 'ATIVA' && o.vaiLiberar > 0)
      if (!op) continue
      achou = true
      const venda = await vendas.obter(ADMIN, op.id)
      for (const p of venda.parcelas.filter((q) => q.falta > 0)) await recebimentos.registrar(ADMIN, 'VENDA', op.id, { forma: 'PIX', parcela: p.numero, valor: p.falta })
      const depois = (await api.detalhe(ADMIN, x.indicador.id)).operacoes.find((o) => o.id === op.id && o.tipo === 'VENDA')!
      expect(depois.status).toBe('QUITADA')
      expect(depois.liberado).toBe(op.parte)
      expect(depois.vaiLiberar).toBe(0)
      break
    }
    expect(achou).toBe(true)
  })
})

describe('pagar o repasse', () => {
  it('parcial: guarda data, forma e quem pagou, e o a pagar cai', async () => {
    const r = await comSaldo()
    const metade = Math.floor(r.resumo.aPagar / 2)
    const out = await api.pagar(ADMIN, r.indicador.id, { valor: metade, forma: 'DINHEIRO', data: '2026-10-05', obs: 'adiantamento' })
    expect(out.repasse).toMatchObject({ valor: metade, forma: 'DINHEIRO', data: '2026-10-05', obs: 'adiantamento', indicadorNome: r.indicador.nome })
    expect(out.detalhe.resumo.pago).toBe(metade)
    expect(out.detalhe.resumo.aPagar).toBeCloseTo(r.resumo.aPagar - metade, 2)
  })
  it('a data padrão é a de hoje da demonstração', async () => {
    const r = await comSaldo()
    expect((await api.pagar(ADMIN, r.indicador.id, { valor: 1, forma: 'PIX' })).repasse.data).toBe('2026-10-08')
  })
  it('paga tudo e depois não há mais nada: mais um centavo é recusado (409)', async () => {
    const r = await comSaldo()
    await api.pagar(ADMIN, r.indicador.id, { valor: r.resumo.aPagar, forma: 'PIX' })
    const e = await falha(api.pagar(ADMIN, r.indicador.id, { valor: 0.01, forma: 'PIX' }))
    expect(e).toMatchObject({ status: 409, codigo: 'VALOR_ACIMA_DO_LIBERADO' })
    expect((await api.detalhe(ADMIN, r.indicador.id)).resumo.aPagar).toBe(0)
  })
  it('não deixa pagar mais do que está a pagar e diz quanto é', async () => {
    const r = await comSaldo()
    const e = await falha(api.pagar(ADMIN, r.indicador.id, { valor: r.resumo.aPagar + 0.01, forma: 'PIX' }))
    expect(e?.status).toBe(409)
    expect(e?.message).toContain(r.resumo.aPagar.toFixed(2).replace('.', ','))
  })
  it('quem não tem nada liberado não recebe: 409', async () => {
    const sem = (await api.resumo(ADMIN)).find((x) => x.resumo.aPagar === 0)!
    expect((await falha(api.pagar(ADMIN, sem.indicador.id, { valor: 1, forma: 'PIX' })))?.status).toBe(409)
  })
  it.each([
    ['valor zero', { valor: 0, forma: 'PIX' }], ['valor negativo', { valor: -5, forma: 'PIX' }], ['valor gigante', { valor: 1e9, forma: 'PIX' }], ['valor NaN', { valor: NaN, forma: 'PIX' }],
    ['forma inválida', { valor: 1, forma: 'CARTAO' }], ['data inválida', { valor: 1, forma: 'PIX', data: '2026-02-31' }], ['data futura', { valor: 1, forma: 'PIX', data: '2026-10-09' }],
    ['data antiga demais', { valor: 1, forma: 'PIX', data: '2019-12-31' }], ['obs enorme', { valor: 1, forma: 'PIX', obs: 'x'.repeat(301) }],
  ])('recusa %s (400) e não grava nada', async (_n, corpo) => {
    const r = await comSaldo()
    expect((await falha(api.pagar(ADMIN, r.indicador.id, corpo as never)))?.status).toBe(400)
    expect(await api.jaPagos(ADMIN)).toHaveLength(0)
  })
  it('a lista de já pagos vem do mais novo ao mais antigo e filtra por indicador', async () => {
    const r = await comSaldo()
    await api.pagar(ADMIN, r.indicador.id, { valor: 1, forma: 'PIX', data: '2026-10-01' })
    await api.pagar(ADMIN, r.indicador.id, { valor: 2, forma: 'PIX', data: '2026-10-07' })
    expect((await api.jaPagos(ADMIN)).map((x) => x.valor)).toEqual([2, 1])
    expect(await api.jaPagos(ADMIN, 999)).toEqual([])
  })
  it('o pagamento abate a operação mais antiga primeiro', async () => {
    const r = await comSaldo()
    const antes = await api.detalhe(ADMIN, r.indicador.id)
    const out = await api.pagar(ADMIN, r.indicador.id, { valor: r.resumo.aPagar, forma: 'PIX' })
    const ordem = out.detalhe.operacoes.map((o) => o.data)
    expect(ordem).toEqual([...ordem].sort())
    expect(out.detalhe.operacoes.every((o) => o.aPagar === 0)).toBe(true)
    expect(antes.operacoes.some((o) => o.aPagar > 0)).toBe(true)
  })
})
