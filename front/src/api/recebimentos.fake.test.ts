import { beforeEach, describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { ErroApi } from './clientes'
import { criarClientesFake } from './clientes.fake'
import { criarEstoqueFake, type EstoqueFake } from './estoque.fake'
import { criarIndicadoresFake } from './indicadores.fake'
import type { EntradaRecebimento, RecebimentosApi } from './recebimentos'
import { criarRecebimentosFake } from './recebimentos.fake'
import { criarVendasFake, type VendasFake } from './vendas.fake'

// Mesmos cenários de back/tests/recebimentos.test.ts: a demonstração tem de se comportar como o backend.
// Venda de 3.000: entrada 600, 4 parcelas de 840 (10/11, 10/12, 10/01, 10/02); o dia de hoje da demonstração é 08/10/2026.
const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const VEND: Sessao = { perfil: 'VENDEDOR', usuarioId: 2 }
const COBR: Sessao = { perfil: 'COBRADOR', usuarioId: 3 } // carteira: Fernanda(3), Carlos(4), Ana Paula(6), João(8)
const COBR2: Sessao = { perfil: 'COBRADOR', usuarioId: 77 }
const IND: Sessao = { perfil: 'INDICADOR', indicadorId: 1 }

let vendas: VendasFake
let estoque: EstoqueFake
let api: RecebimentosApi
beforeEach(() => {
  estoque = criarEstoqueFake()
  vendas = criarVendasFake({ estoque, indicadores: criarIndicadoresFake(), clientes: criarClientesFake() })
  api = criarRecebimentosFake(vendas)
})
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)

async function venda(clienteId = 3): Promise<number> {
  const a = await estoque.criar(ADMIN, { modelo: 'iPhone 13', gb: 128, cor: 'Preto', preco: 3000, custo: 2000 })
  return (await vendas.criar(ADMIN, { aparelhoId: a.id, clienteId, preco: 3000, entrada: 600, parcelas: 4, diaVencimento: 10 })).id
}
const receber = (s: Sessao, vendaId: number, e: Partial<EntradaRecebimento>) => api.registrar(s, 'VENDA', vendaId, { parcela: 1, valor: 840, forma: 'PIX', ...e })
const parcelas = async (vendaId: number) => (await vendas.obter(ADMIN, vendaId)).parcelas

describe('permissões', () => {
  it('vendedor e indicador não mexem com recebimentos (403)', async () => {
    const v = await venda()
    for (const s of [VEND, IND]) {
      expect((await falha(receber(s, v, {})))?.status).toBe(403)
      expect((await falha(api.pagamentos(s, 'VENDA', v)))?.status).toBe(403)
      // a lista de cobranças: o vendedor não vê; o indicador vê só a das operações dele (indicador-leitura.fake.test.ts)
      if (s === VEND) expect((await falha(api.cobrancas(s, {})))?.status).toBe(403)
      else expect(await falha(api.cobrancas(s, {}))).toBeNull()
      expect((await falha(api.desfazer(s, 1)))?.status).toBe(403)
    }
  })
  it('cobrador só mexe na venda de cliente da carteira dele (404 nas outras)', async () => {
    const deOutro = await venda(1) // Juliana: carteira do vendedor
    expect((await falha(receber(COBR, deOutro, {})))?.status).toBe(404)
    expect((await falha(api.pagamentos(COBR, 'VENDA', deOutro)))?.status).toBe(404)
    expect((await receber(COBR, await venda(3), {})).recibo.valor).toBe(840)
  })
})

describe('pagou o valor certo', () => {
  it('quita a parcela e devolve o recibo com o texto do WhatsApp', async () => {
    const v = await venda()
    const r = await receber(ADMIN, v, {})
    expect(r.efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }])
    expect(r.quitada).toBe(false)
    expect(r.recibo).toMatchObject({ valor: 840, forma: 'PIX', data: '2026-10-08', referencia: 'parcela 1/4', faltaDepois: 2520, restantes: 3, proxima: { numero: 2, valor: 840, vencimento: '2026-12-10' }, desfeita: false, recebidoPor: 'Geovane' })
    expect(r.recibo.numero).toMatch(/^\d{6}$/)
    expect(r.recibo.mensagem).toContain('Recebemos R$ 840,00 em 08/10/2026 (Pix), referente à parcela 1/4 do seu iPhone 13.')
    expect(r.recibo.mensagem).toContain('Próxima: 2ª, R$ 840,00, vence 10/12. Faltam 3 parcelas (R$ 2.520,00).')
    expect(r.recibo.cliente.fone).toBe('11991027744')
  })
  it('quitar tudo fecha a venda; pagar de novo é 409', async () => {
    const v = await venda()
    const r = await receber(ADMIN, v, { valor: 3360 })
    expect(r.quitada).toBe(true)
    expect(r.recibo.mensagem).toContain('Tudo quitado!')
    expect((await vendas.obter(ADMIN, v)).status).toBe('QUITADA')
    expect(await falha(receber(ADMIN, v, { parcela: 4, valor: 10 }))).toMatchObject({ status: 409, codigo: 'PARCELA_PAGA' })
  })
})

describe('pagou menos', () => {
  it('fica devendo com nova data: resto na parcela, vencimento novo, o antigo guardado', async () => {
    const v = await venda()
    // adianta o relógio da demonstração: a 1ª vence em 10/11, então "mantém" a data (ainda não venceu)
    const r = await receber(ADMIN, v, { valor: 100, resto: 'FICA', novoVencimento: '2026-11-27' })
    expect(r.efeitos).toEqual([{ tipo: 'FICA', numero: 1, resta: 740, vencimento: '2026-11-27' }])
    expect(r.recibo.ficaDevendo).toEqual({ numero: 1, valor: 740, vencimento: '2026-11-27' })
    expect(r.recibo.mensagem).toContain('Na 1ª ainda ficam R$ 740,00, para 27/11.')
    const f = (await parcelas(v))[0]
    expect(f).toMatchObject({ vencimento: '2026-11-27', vencimentoOriginal: '2026-11-10', pago: 100, falta: 740 })
    expect((await parcelas(v))[1].vencimento).toBe('2026-12-10') // as próximas ficam nas datas delas
  })
  it('sem dizer o que fazer com o resto, recusa; data nova no passado, recusa', async () => {
    const v = await venda()
    expect(await falha(receber(ADMIN, v, { valor: 100 }))).toMatchObject({ status: 400, codigo: 'RESTO_OBRIGATORIO' })
    expect((await falha(receber(ADMIN, v, { valor: 100, resto: 'FICA', novoVencimento: '2026-10-01' })))?.codigo).toBe('VENCIMENTO_INVALIDO')
  })
  it('desconto (admin) quita a parcela; o cobrador não dá desconto (403)', async () => {
    const v = await venda()
    expect((await receber(ADMIN, v, { valor: 100, resto: 'DESCONTO' })).efeitos).toEqual([{ tipo: 'DESCONTO', numero: 1, valor: 740 }])
    expect((await parcelas(v))[0]).toMatchObject({ desconto: 740, falta: 0 })
    const v2 = await venda()
    const e = await falha(receber(COBR, v2, { valor: 100, resto: 'DESCONTO' }))
    expect(e?.status).toBe(403)
    expect(e?.message).toMatch(/aprovação/)
  })
})

describe('pagou a mais', () => {
  it('quita a atual e as próximas e abate o resto da seguinte, numa transação só', async () => {
    const v = await venda()
    const r = await receber(ADMIN, v, { valor: 2000 })
    expect(r.efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }, { tipo: 'QUITA', numero: 2 }, { tipo: 'ABATE', numero: 3, valor: 320 }])
    expect(r.recibo).toMatchObject({ referencia: 'parcelas 1 a 3 de 4', valor: 2000, faltaDepois: 1360, restantes: 2, proxima: { numero: 3, valor: 520 } })
    expect((await api.pagamentos(ADMIN, 'VENDA', v)).filter((p) => p.tipo === 'PARCELA')).toHaveLength(1)
  })
  it('valor acima do que falta é recusado (não vira crédito)', async () => {
    const v = await venda()
    expect((await falha(receber(ADMIN, v, { valor: 3360.01 })))?.codigo).toBe('EXCEDE_DIVIDA')
  })
})

describe('validações', () => {
  it.each([
    ['parcela zero', { parcela: 0 }], ['valor zero', { valor: 0 }], ['valor negativo', { valor: -5 }], ['forma inventada', { forma: 'FIADO' }],
    ['data em outro formato', { data: '08/10/2026' }], ['data no futuro', { data: '2026-10-09' }], ['data antes da venda', { data: '2026-10-07' }], ['resto inventado', { valor: 100, resto: 'TALVEZ' }],
  ])('recusa %s (400)', async (_n, m) => {
    const v = await venda()
    expect((await falha(receber(ADMIN, v, m as Partial<EntradaRecebimento>)))?.status).toBe(400)
  })
  it('parcela e venda inexistentes são 404', async () => {
    const v = await venda()
    expect((await falha(receber(ADMIN, v, { parcela: 9 })))?.status).toBe(404)
    expect((await falha(receber(ADMIN, 999999, {})))?.status).toBe(404)
  })
  it('o cobrador só lança o que recebeu hoje; o admin pode lançar uma data passada (depois da venda)', async () => {
    const dele = (await api.cobrancas(COBR, { aba: 'atrasadas', limite: 100 })).itens[0] // venda antiga dos dados de exemplo
    const passada = { parcela: dele.parcela, valor: 10, resto: 'FICA' as const, novoVencimento: '2026-10-20', data: '2026-09-20' }
    expect((await falha(api.registrar(COBR, 'VENDA', dele.operacaoId, { ...passada, forma: 'PIX' })))?.status).toBe(403)
    const r = await api.registrar(ADMIN, 'VENDA', dele.operacaoId, { ...passada, forma: 'PIX' })
    expect(r.recibo.data).toBe('2026-09-20')
    expect((await falha(api.registrar(COBR, 'VENDA', dele.operacaoId, { ...passada, data: '2026-10-08', forma: 'PIX', parcela: dele.parcela })))).toBeNull() // hoje: ok
  })
  it('venda retomada não recebe pagamento (409)', async () => {
    const v = await venda()
    vendas._interno.registros.find((r) => r.id === v)!.status = 'RETOMADA'
    expect((await falha(receber(ADMIN, v, {})))?.codigo).toBe('VENDA_ENCERRADA')
  })
})

describe('desfazer', () => {
  async function duasBaixas() {
    const v = await venda()
    const a = (await receber(ADMIN, v, { parcela: 1 })).recibo.id
    const b = (await receber(ADMIN, v, { parcela: 2 })).recibo.id
    return { v, a, b }
  }
  it('só o último recebimento da venda se desfaz; depois, o anterior passa a ser o último', async () => {
    const { v, a, b } = await duasBaixas()
    expect(await falha(api.desfazer(ADMIN, a))).toMatchObject({ status: 409, codigo: 'NAO_E_O_ULTIMO' })
    await api.desfazer(ADMIN, b)
    await api.desfazer(ADMIN, a)
    expect((await parcelas(v)).map((p) => p.pago)).toEqual([0, 0, 0, 0])
    expect((await parcelas(v)).every((p) => p.quitadaEm === null)).toBe(true)
  })
  it('desfazer de novo é 409; inexistente é 404; a entrada não se desfaz aqui', async () => {
    const { v, b } = await duasBaixas()
    await api.desfazer(ADMIN, b)
    expect((await falha(api.desfazer(ADMIN, b)))?.codigo).toBe('JA_DESFEITO')
    expect((await falha(api.desfazer(ADMIN, 999999)))?.status).toBe(404)
    const entrada = (await api.pagamentos(ADMIN, 'VENDA', v)).find((p) => p.tipo === 'ENTRADA')!
    expect((await falha(api.desfazer(ADMIN, entrada.transacaoId)))?.codigo).toBe('ENTRADA_NAO_DESFAZ')
  })
  it('volta tudo como estava: vencimento remarcado, desconto e venda quitada', async () => {
    const v = await venda()
    const antes = JSON.stringify(await parcelas(v))
    const parcial = (await receber(ADMIN, v, { valor: 100, resto: 'FICA', novoVencimento: '2026-11-27' })).recibo.id
    await api.desfazer(ADMIN, parcial)
    expect(JSON.stringify(await parcelas(v))).toBe(antes)
    const desc = (await receber(ADMIN, v, { valor: 100, resto: 'DESCONTO' })).recibo.id
    await api.desfazer(ADMIN, desc)
    expect(JSON.stringify(await parcelas(v))).toBe(antes)
    const tudo = (await receber(ADMIN, v, { valor: 3360 })).recibo.id
    expect((await vendas.obter(ADMIN, v)).status).toBe('QUITADA')
    await api.desfazer(ADMIN, tudo)
    expect((await vendas.obter(ADMIN, v)).status).toBe('ATIVA')
    expect(JSON.stringify(await parcelas(v))).toBe(antes)
  })
  it('o recibo desfeito continua existindo, marcado como desfeito', async () => {
    const { b } = await duasBaixas()
    await api.desfazer(ADMIN, b)
    expect((await api.recibo(ADMIN, b)).desfeita).toBe(true)
  })
  it('o cobrador desfaz só o que ele mesmo recebeu hoje', async () => {
    const v = await venda(3)
    const doAdmin = (await receber(ADMIN, v, { parcela: 1 })).recibo.id
    expect((await falha(api.desfazer(COBR, doAdmin)))?.status).toBe(403)
    const doCobrador = (await receber(COBR, v, { parcela: 2 })).recibo.id
    expect((await falha(api.desfazer(COBR2, doCobrador)))?.status).toBe(404) // outra carteira
    await api.desfazer(COBR, doCobrador)
  })
})

describe('recibos e pagamentos', () => {
  it('lista os pagamentos (entrada e parcelas) e diz o que dá para desfazer', async () => {
    const v = await venda(3)
    await receber(ADMIN, v, { parcela: 1 })
    const u = (await receber(COBR, v, { parcela: 2 })).recibo.id
    const lista = await api.pagamentos(ADMIN, 'VENDA', v)
    expect(lista.map((p) => p.tipo)).toEqual(['PARCELA', 'PARCELA', 'ENTRADA'])
    expect(lista.map((p) => p.referencia)).toEqual(['parcela 2/4', 'parcela 1/4', 'entrada'])
    expect(lista.filter((p) => p.podeDesfazer).map((p) => p.transacaoId)).toEqual([u])
    expect((await api.pagamentos(COBR, 'VENDA', v)).filter((p) => p.podeDesfazer)).toHaveLength(1)
  })
  it('o recibo da entrada mostra o que ficou combinado para pagar', async () => {
    const v = await venda()
    const entrada = (await api.pagamentos(ADMIN, 'VENDA', v)).find((p) => p.tipo === 'ENTRADA')!
    const r = await api.recibo(ADMIN, entrada.transacaoId)
    expect(r).toMatchObject({ valor: 600, referencia: 'entrada', faltaDepois: 3360, restantes: 4, proxima: { numero: 1, valor: 840, vencimento: '2026-11-10' } })
    expect(r.mensagem).toContain('referente à entrada do seu iPhone 13.')
  })
  it('o recibo é um retrato: pagamentos depois não mudam o que estava escrito', async () => {
    const v = await venda()
    const a = (await receber(ADMIN, v, { parcela: 1 })).recibo
    await receber(ADMIN, v, { parcela: 2 })
    expect(await api.recibo(ADMIN, a.id)).toMatchObject({ faltaDepois: 2520, restantes: 3, mensagem: a.mensagem })
  })
  it('o cobrador só abre recibo de cliente da carteira dele', async () => {
    const v = await venda(3)
    const r = (await receber(COBR, v, { parcela: 1 })).recibo.id
    expect((await falha(api.recibo(COBR2, r)))?.status).toBe(404)
    expect((await api.recibo(COBR, r)).id).toBe(r)
  })
})

describe('cobranças', () => {
  it('separa atrasadas, esta semana, próximas e recebidas, com contagens e valor total', async () => {
    const hoje = await api.cobrancas(ADMIN, { aba: 'atrasadas', limite: 100 })
    expect(hoje.itens.every((c) => c.falta > 0 && c.atrasoDias > 0)).toBe(true)
    expect(hoje.contagens.atrasadas).toBe(hoje.total)
    expect(hoje.valorTotal).toBeCloseTo(hoje.itens.reduce((s, c) => s + c.falta, 0), 2)
    const semana = await api.cobrancas(ADMIN, { aba: 'hoje', limite: 100 })
    expect(semana.itens.every((c) => c.vencimento >= '2026-10-08' && c.vencimento <= '2026-10-15')).toBe(true)
  })
  it('parcela remarcada sai dos atrasados; a recebida entra nas recebidas com a última transação', async () => {
    const v = await venda(3)
    const antes = (await api.cobrancas(ADMIN, { aba: 'atrasadas', limite: 100 })).total
    // a venda nova não tem atraso; usamos uma parcela de exemplo atrasada de uma venda da carteira do cobrador
    const atrasada = (await api.cobrancas(COBR, { aba: 'atrasadas', limite: 100 })).itens[0]
    const r = await receber(COBR, atrasada.operacaoId, { parcela: atrasada.parcela, valor: 10, resto: 'FICA', novoVencimento: '2026-10-20' })
    expect((await api.cobrancas(ADMIN, { aba: 'atrasadas', limite: 100 })).total).toBe(antes - 1)
    const rec = (await api.cobrancas(ADMIN, { aba: 'recebidas', limite: 100 })).itens.find((c) => c.operacaoId === atrasada.operacaoId && c.parcela === atrasada.parcela)!
    expect(rec).toMatchObject({ ultimaTransacaoId: r.recibo.id, ultimoRecebimentoEm: '2026-10-08' })
    expect(v).toBeGreaterThan(0)
  })
  it('o cobrador só vê a carteira dele; aba inválida é 400; corta o limite em 100', async () => {
    const dele = (await api.cobrancas(COBR, { aba: 'atrasadas', limite: 100 })).itens
    expect(dele.length).toBeGreaterThan(0)
    expect(dele.every((c) => [3, 4, 6, 8].includes(c.cliente.id))).toBe(true)
    expect((await falha(api.cobrancas(ADMIN, { aba: 'xyz' as never })))?.status).toBe(400)
    expect((await api.cobrancas(ADMIN, { limite: 99999 })).limite).toBe(100)
  })
})
