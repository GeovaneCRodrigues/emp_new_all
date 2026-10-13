import type { Knex } from 'knex'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { BemAntigo, EstadoVendasAntigo, VendaAntiga, VendaParcelaAntiga, VendaRecebimentoAntigo } from '../src/migracao/antigo/tipos-vendas.js'
import { formatarRelatorioVendas, importarVendas } from '../src/migracao/importar-vendas.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()

const bem = (id: number, o: Partial<BemAntigo> = {}): BemAntigo => ({
  id, categoria: 'IPHONE', descricao: `iphone 1${id} pro`, estado: 'VENDIDO', origem: 'COMPRA', identificador: null, valorCompra: 4000, custosExtras: 0, precoVendaSugerido: 4500, dataCompra: '2026-06-01',
  clienteEncomendaId: null, dados: { condicao: 'SEMINOVO', capacidadeGb: 128, cor: 'azul' }, observacoes: null, ...o,
})
const venda = (id: number, bemId: number, o: Partial<VendaAntiga> = {}): VendaAntiga => ({
  id, bemId, clienteId: 10, indicadorId: 1, percentualParceiro: 50, dataVenda: '2026-06-25', valorInvestido: 4000, entrada: 800, trocaValor: 0, trocaBemId: null, valorTotal: 2800, status: 'ATIVA', observacoes: null, criadoEm: '2026-06-25T15:00:00Z', ...o,
})
let seq = 0
const parc = (id: number, vendaId: number, numero: number, venc: string, valor: number): VendaParcelaAntiga => ({ id, vendaId, numero, vencimento: venc, valor, vencimentoOriginal: null })
const rec = (vendaId: number, tipo: VendaRecebimentoAntigo['tipo'], valor: number, data: string, parcelaId: number | null = null, desconto = 0): VendaRecebimentoAntigo => ({ id: ++seq, vendaId, parcelaId, tipo, valor, desconto, dataRecebimento: data, criadoEm: null })

const cenario = (): EstadoVendasAntigo => ({
  bens: [bem(1), bem(2, { origem: 'TROCA', valorCompra: 3000 }), bem(3, { estado: 'DISPONIVEL', precoVendaSugerido: null }), bem(4, { estado: 'ENCOMENDADO', clienteEncomendaId: 11 })],
  vendas: [venda(1, 1), venda(2, 1 + 1, { clienteId: 11, entrada: 0, trocaValor: 1000, trocaBemId: 3, valorTotal: 1000 + 1000, indicadorId: null, percentualParceiro: 0 })],
  parcelas: [parc(100, 1, 1, '2026-07-25', 1000), parc(101, 1, 2, '2026-08-25', 1000), parc(200, 2, 1, '2026-09-25', 1000)],
  recebimentos: [rec(1, 'ENTRADA', 800, '2026-06-25'), rec(1, 'PARCELA', 1000, '2026-07-25', 100), rec(2, 'TROCA', 1000, '2026-06-30'), rec(2, 'PARCELA', 700, '2026-09-25', 200, 300)],
  ajustes: [], repasses: [{ id: 1, vendaId: 1, indicadorId: 1, valor: 575, dataRepasse: '2026-09-17', obs: 'acerto' }],
})

describe.skipIf(!db)('importar estoque e vendas do sistema antigo (Postgres de verdade)', () => {
  const conta = async (t: string) => Number(((await db!(t).count('* as n').first()) as { n: string }).n)
  beforeEach(async () => {
    await limparBanco(db!)
    await db!('indicadores').insert({ nome: 'IND UM', pct: 0.5, pct_manual: false, ativo: true, legacy_id: 1 })
    await db!('clientes').insert([{ nome: 'CLIENTE A', fone: '', legacy_id: 10 }, { nome: 'CLIENTE B', fone: '', legacy_id: 11 }])
  })
  afterAll(async () => { await db?.destroy() })

  it('SIMULAÇÃO: relatório completo, nada gravado', async () => {
    const r = await importarVendas(db!, cenario(), { aplicar: false })
    expect(r.modo).toBe('SIMULACAO'); expect(r.bens.criados).toBe(4); expect(r.vendas.criadas).toBe(2)
    for (const t of ['bens', 'vendas', 'venda_parcelas', 'transacoes_recebimento', 'recebimentos', 'repasses_indicador']) expect(await conta(t), t).toBe(0)
  })

  it('APLICAR: grava aparelhos, vendas, parcelas, recibos e repasse, e as conferências fecham', async () => {
    const r = await importarVendas(db!, cenario(), { aplicar: true })
    expect(r.conferencias.length).toBeGreaterThanOrEqual(12)
    expect(await conta('bens')).toBe(4); expect(await conta('vendas')).toBe(2); expect(await conta('venda_parcelas')).toBe(3)
    expect(await conta('transacoes_recebimento')).toBe(3) // entrada + 2 parcelas (a troca não gera recibo)
    expect(r.recibos).toBe(3); expect(r.totais.recebido).toBe(800 + 1000 + 1000 + 700); expect(r.totais.descontos).toBe(300)
    const b = await db!('bens').where({ legacy_id: 1 }).first()
    expect(b).toMatchObject({ modelo: 'IPHONE 11 PRO', gb: 128, cor: 'AZUL', condicao: 'Seminovo', estado: 'VENDIDO', bateria: 0 })
    const b3 = await db!('bens').where({ legacy_id: 3 }).first(); expect(Number(b3.preco_venda)).toBe(4000); expect(b3.observacoes).toMatch(/provisório/)
    const v1 = await db!('vendas').where({ legacy_id: 1 }).first()
    expect(Number(v1.percentual_indicador)).toBe(0.5); expect(Number(v1.valor_total)).toBe(2800); expect(Number(v1.preco_acordado)).toBe(2800); expect(Number(v1.juros_pct)).toBe(0); expect(v1.status).toBe('ATIVA')
    const v2 = await db!('vendas').where({ legacy_id: 2 }).first()
    expect(v2.status).toBe('QUITADA'); expect(v2.troca_bem_id).toBe((await db!('bens').where({ legacy_id: 3 }).first()).id)
    const p = await db!('venda_parcelas').where({ legacy_id: 200 }).first(); expect(Number(p.desconto)).toBe(300); expect(String(p.quitada_em)).toContain('2026')
    const enc = await db!('bens').where({ legacy_id: 4 }).first(); expect(enc.cliente_encomenda_id).toBe((await db!('clientes').where({ legacy_id: 11 }).first()).id)
    expect(Number(await db!('repasses_indicador').sum({ s: 'valor' }).first().then((x) => (x as { s: string }).s))).toBe(575)
  })

  it('os recibos da entrada e das parcelas têm o formato do sistema novo', async () => {
    await importarVendas(db!, cenario(), { aplicar: true })
    const t = await db!('transacoes_recebimento').orderBy('numero_recibo')
    expect(t.map((x) => [x.forma_pagamento, x.forma_estimada, x.recebido_por])).toEqual([['PIX', true, null], ['PIX', true, null], ['PIX', true, null]])
    const ent = await db!('recebimentos').where({ tipo: 'ENTRADA' }).first(); expect(ent.venda_id).toBe((await db!('vendas').where({ legacy_id: 1 }).first()).id); expect(ent.venda_parcela_id).toBeNull()
    const parcRec = await db!('recebimentos').where({ tipo: 'PARCELA' }).orderBy('id')
    expect(parcRec.every((x) => x.venda_parcela_id !== null && x.emprestimo_parcela_id === null)).toBe(true)
    expect(parcRec[1].antes).toEqual({ vencimento: '2026-09-25', vencimentoOriginal: null, desconto: 0, quitadaEm: null })
  })

  it('a numeração dos recibos é refeita por data quando só há recibos do antigo (juntando empréstimos e vendas)', async () => {
    const cli = await db!('clientes').where({ legacy_id: 10 }).first()
    // um recibo "de empréstimo" já importado, de data POSTERIOR a todos os de venda
    const [{ n }] = (await db!.raw("select nextval('recibo_numero_seq') as n")).rows
    await db!('transacoes_recebimento').insert({ numero_recibo: Number(n), cliente_id: cli.id, valor_total: 10, forma_pagamento: 'PIX', data_recebimento: '2026-10-01', legacy_id: 999 })
    const r = await importarVendas(db!, cenario(), { aplicar: true })
    expect(r.recibosRenumerados).toBe(true)
    const t = await db!('transacoes_recebimento').orderBy('numero_recibo')
    expect(t.map((x) => x.numero_recibo)).toEqual([1, 2, 3, 4])
    expect(t.map((x) => String(x.data_recebimento).slice(0, 15))).toEqual([...t.map((x) => String(x.data_recebimento).slice(0, 15))].sort((a, b) => new Date(a).getTime() - new Date(b).getTime()))
    expect(t[3].legacy_id).toBe(999)
    const [{ n: prox }] = (await db!.raw("select nextval('recibo_numero_seq') as n")).rows; expect(Number(prox)).toBe(5) // o próximo recibo novo continua dali
  })

  it('com recibo nativo do sistema novo, a numeração NÃO é mexida', async () => {
    const cli = await db!('clientes').where({ legacy_id: 10 }).first()
    const [{ n }] = (await db!.raw("select nextval('recibo_numero_seq') as n")).rows
    await db!('transacoes_recebimento').insert({ numero_recibo: Number(n), cliente_id: cli.id, valor_total: 10, forma_pagamento: 'PIX', data_recebimento: '2026-10-01' })
    const r = await importarVendas(db!, cenario(), { aplicar: true })
    expect(r.recibosRenumerados).toBe(false); expect(r.avisos.recibos_nao_renumerados_ha_recibos_novos).toBe(1)
    expect((await db!('transacoes_recebimento').where({ valor_total: 10 }).first()).numero_recibo).toBe(Number(n)) // o recibo nativo mantém o número
  })

  it('sequência de recibos atrasada (sobra de simulações) não quebra a carga', async () => {
    const cli = await db!('clientes').where({ legacy_id: 10 }).first()
    await db!('transacoes_recebimento').insert({ numero_recibo: 500, cliente_id: cli.id, valor_total: 10, forma_pagamento: 'PIX', data_recebimento: '2026-10-01', legacy_id: 999 })
    await db!.raw("select setval('recibo_numero_seq', 3)")
    const r = await importarVendas(db!, cenario(), { aplicar: true })
    expect(r.recibos).toBe(3); expect(await conta('transacoes_recebimento')).toBe(4)
  })

  it('SIMULAR não mexe na sequência dos recibos', async () => {
    await db!.raw("select setval('recibo_numero_seq', 42)")
    await importarVendas(db!, cenario(), { aplicar: false })
    const [{ last_value: depois }] = (await db!.raw('select last_value from recibo_numero_seq')).rows
    // a simulação consome números (nextval), mas não pode ter "arrumado" a sequência para trás
    expect(Number(depois)).toBeGreaterThanOrEqual(42)
  })

  it('RODAR DE NOVO não duplica nada', async () => {
    await importarVendas(db!, cenario(), { aplicar: true })
    const antes = { b: await conta('bens'), v: await conta('vendas'), t: await conta('transacoes_recebimento'), r: await conta('repasses_indicador') }
    const r = await importarVendas(db!, cenario(), { aplicar: true })
    expect(r.bens).toMatchObject({ criados: 0, jaExistiam: 4 }); expect(r.vendas).toMatchObject({ criadas: 0, jaExistiam: 2 }); expect(r.recibos).toBe(0); expect(r.repasses).toMatchObject({ criados: 0, jaExistiam: 1 })
    expect({ b: await conta('bens'), v: await conta('vendas'), t: await conta('transacoes_recebimento'), r: await conta('repasses_indicador') }).toEqual(antes)
  })

  it('venda de cliente ou indicador que não foi importado fica de fora, com o motivo', async () => {
    const e = cenario(); e.vendas.push(venda(3, 4, { clienteId: 999 }), venda(4, 3, { indicadorId: 77 }))
    const r = await importarVendas(db!, e, { aplicar: true })
    expect(r.vendas).toMatchObject({ criadas: 2, semCliente: 1, semIndicador: 1 })
    expect(r.problemas.map((p) => p.motivo)).toEqual(expect.arrayContaining(['o cliente ainda não foi importado', 'o indicador ainda não foi importado']))
  })

  it('duas vendas ativas do mesmo aparelho: a carga inteira volta', async () => {
    const e = cenario(); e.vendas.push(venda(5, 1)); e.parcelas.push(parc(500, 5, 1, '2026-12-25', 2000))
    await expect(importarVendas(db!, e, { aplicar: true })).rejects.toThrow()
    for (const t of ['bens', 'vendas', 'venda_parcelas', 'transacoes_recebimento', 'recebimentos', 'repasses_indicador']) expect(await conta(t), t).toBe(0)
  })

  it('recebimento duplicado na origem é pego pela conferência contra o antigo (carga inteira desfeita)', async () => {
    const e = cenario(); e.recebimentos.push({ ...e.recebimentos[0] })
    await expect(importarVendas(db!, e, { aplicar: true })).rejects.toThrow(/Conferência falhou/)
    expect(await conta('vendas')).toBe(0)
  })

  it('o relatório em texto não leva nome nem dado pessoal', async () => {
    const txt = formatarRelatorioVendas(await importarVendas(db!, cenario(), { aplicar: false }))
    expect(txt).toContain('SIMULAÇÃO'); expect(txt).toContain('Vendas: 2'); expect(txt).not.toMatch(/CLIENTE A|IND UM|IPHONE 11/)
  })
})
