import { describe, expect, it } from 'vitest'
import type { BemAntigo, EstadoVendasAntigo, VendaAntiga, VendaParcelaAntiga, VendaRecebimentoAntigo } from '../src/migracao/antigo/tipos-vendas.js'
import { lerCapacidade, modeloSemCapacidade, transformarBem, transformarVenda } from '../src/migracao/antigo/transformar-vendas.js'

const bem = (id: number, o: Partial<BemAntigo> = {}): BemAntigo => ({
  id, categoria: 'IPHONE', descricao: 'IPHONE 15 PRO MAX 128GB', estado: 'VENDIDO', origem: 'COMPRA', identificador: null, valorCompra: 4000, custosExtras: 0, precoVendaSugerido: 4500,
  dataCompra: '2026-06-01', clienteEncomendaId: null, dados: { modelo: 'IPHONE 15 PRO MAX', condicao: 'SEMINOVO', capacidadeGb: 128 }, observacoes: null, ...o,
})
const venda = (id: number, o: Partial<VendaAntiga> = {}): VendaAntiga => ({
  id, bemId: 1, clienteId: 10, indicadorId: 3, percentualParceiro: 50, dataVenda: '2026-06-25', valorInvestido: 4000, entrada: 800, trocaValor: 0, trocaBemId: null, valorTotal: 2000 + 800, status: 'ATIVA',
  observacoes: null, criadoEm: '2026-06-25T15:00:00Z', ...o,
})
const parc = (id: number, vendaId: number, numero: number, venc: string, valor: number, o: Partial<VendaParcelaAntiga> = {}): VendaParcelaAntiga => ({ id, vendaId, numero, vencimento: venc, valor, vencimentoOriginal: null, ...o })
let seq = 0
const rec = (vendaId: number, tipo: VendaRecebimentoAntigo['tipo'], valor: number, data: string, parcelaId: number | null = null, desconto = 0): VendaRecebimentoAntigo => ({ id: ++seq, vendaId, parcelaId, tipo, valor, desconto, dataRecebimento: data, criadoEm: null })
const estado = (e: Partial<EstadoVendasAntigo> = {}): EstadoVendasAntigo => ({ bens: [bem(1)], vendas: [], parcelas: [], recebimentos: [], ajustes: [], repasses: [], ...e })
const um = (v: VendaAntiga, e: Partial<EstadoVendasAntigo>) => { const r = transformarVenda(v, estado({ vendas: [v], ...e })); expect(r.erro).toBeUndefined(); return { ...r.novo!, avisos: r.avisos } }
const soma = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100

const parcelasPadrao = () => [parc(100, 1, 1, '2026-07-25', 500), parc(101, 1, 2, '2026-08-25', 500), parc(102, 1, 3, '2026-09-25', 500), parc(103, 1, 4, '2026-10-25', 500)]

describe('aparelhos do estoque', () => {
  it('capacidade: do campo do antigo, ou lida da descrição', () => {
    expect(lerCapacidade('IPHONE 15', { capacidadeGb: 256 })).toBe(256)
    expect(lerCapacidade('IPHONE 17 PRO 256GB - BLUE', null)).toBe(256)
    expect(lerCapacidade('POCCO M8 PRO 512GB', {})).toBe(512)
    expect(lerCapacidade('IPHONE 14 128 (SEMI NOVO)', null)).toBe(128)
    expect(lerCapacidade('IPHONE 17 PRO MAX (1 TB)', null)).toBe(1024)
    expect(lerCapacidade('IPHONE 16 LACRADO', null)).toBe(0)
    expect(lerCapacidade('IPHONE 17 PRO MAX 256 (LACRADO)', null)).toBe(256)
  })
  it('o modelo não repete a capacidade que já tem campo próprio', () => {
    expect(modeloSemCapacidade('IPHONE 15 PRO MAX 128GB', 128)).toBe('IPHONE 15 PRO MAX')
    expect(modeloSemCapacidade('IPHONE 17 PRO 256GB - BLUE', 256)).toBe('IPHONE 17 PRO - BLUE')
    expect(modeloSemCapacidade('IPHONE 14 128 (SEMI NOVO)', 128)).toBe('IPHONE 14 (SEMI NOVO)')
    expect(modeloSemCapacidade('IPHONE 17 PRO MAX (1 TB)', 1024)).toBe('IPHONE 17 PRO MAX')
    expect(modeloSemCapacidade('IPHONE 17 PRO MAX 256 (LACRADO)', 256)).toBe('IPHONE 17 PRO MAX (LACRADO)')
    expect(modeloSemCapacidade('iphone 16 lacrado', 0)).toBe('IPHONE 16 LACRADO') // sem capacidade conhecida, nada é cortado
    expect(modeloSemCapacidade('IPHONE 15 128GB', 256)).toBe('IPHONE 15 128GB') // o campo diz outra coisa: não mexe no texto
  })
  it('converte o aparelho: modelo em maiúsculas, condição, custos e estado', () => {
    const { novo, avisos } = transformarBem(bem(5, { descricao: 'iphone 17 pro max', dados: { condicao: 'NOVO', cor: 'laranja', capacidadeGb: 256 } }))
    expect(novo).toMatchObject({ legacyId: 5, modelo: 'IPHONE 17 PRO MAX', gb: 256, cor: 'LARANJA', condicao: 'Novo', valorCompra: 4000, precoVenda: 4500, estado: 'VENDIDO', origem: 'COMPRA', imei: null, bateria: 0 })
    expect(avisos).toContain('bateria_nao_informada'); expect(avisos).not.toContain('cor_nao_informada'); expect(avisos).not.toContain('capacidade_nao_informada')
  })
  it('o que não veio fica marcado "A DEFINIR" e anotado nas observações (nada é inventado)', () => {
    const { novo, avisos } = transformarBem(bem(6, { descricao: 'IPHONE 16 LACRADO', dados: { condicao: 'SEMINOVO' } }))
    expect(novo).toMatchObject({ gb: 0, cor: 'A DEFINIR', condicao: 'Seminovo' })
    expect(novo.observacoes).toMatch(/capacidade, cor, bateria/); expect(avisos).toEqual(expect.arrayContaining(['capacidade_nao_informada', 'cor_nao_informada']))
  })
  it('sem preço de venda: provisório = custo, com aviso', () => {
    const { novo, avisos } = transformarBem(bem(7, { precoVendaSugerido: null, valorCompra: 6100, custosExtras: 100 }))
    expect(novo.precoVenda).toBe(6200); expect(avisos).toContain('preco_a_definir'); expect(novo.observacoes).toMatch(/provisório/)
  })
  it('fora de iPhone (tablet, outro celular) entra, anotando a categoria; observação original preservada', () => {
    const { novo, avisos } = transformarBem(bem(8, { categoria: 'OUTRO', descricao: 'TABLET REDMI PAD SE2', dados: {}, observacoes: 'caixa original' }))
    expect(novo.modelo).toBe('TABLET REDMI PAD SE2'); expect(novo.observacoes).toMatch(/^caixa original/); expect(novo.observacoes).toMatch(/OUTRO/); expect(avisos).toContain('categoria_fora_de_iphone')
  })
  it('identificador de 15 dígitos vira IMEI; outro formato fica nas observações', () => {
    expect(transformarBem(bem(9, { identificador: '35-123456-789012-3' })).novo.imei).toBe('351234567890123')
    const r = transformarBem(bem(9, { identificador: 'ABC123' })); expect(r.novo.imei).toBeNull(); expect(r.novo.observacoes).toMatch(/ABC123/)
  })
  it('a reserva para o cliente só vale para aparelho ainda encomendado', () => {
    expect(transformarBem(bem(1, { estado: 'ENCOMENDADO', clienteEncomendaId: 55 })).novo.clienteEncomendaLegacyId).toBe(55)
    expect(transformarBem(bem(1, { estado: 'VENDIDO', clienteEncomendaId: 55 })).novo.clienteEncomendaLegacyId).toBeNull()
  })
})

describe('venda parcelada com entrada', () => {
  const v = venda(1, { valorTotal: 800 + 2000 })
  const base = () => ({ parcelas: parcelasPadrao(), recebimentos: [rec(1, 'ENTRADA', 800, '2026-06-25'), rec(1, 'PARCELA', 500, '2026-07-25', 100), rec(1, 'PARCELA', 500, '2026-08-25', 101)] })
  it('converte a venda, o % (50 pontos → 0,5), as parcelas e o status', () => {
    const n = um(v, base())
    expect(n).toMatchObject({ legacyId: 1, bemLegacyId: 1, clienteLegacyId: 10, indicadorLegacyId: 3, pct: 0.5, entrada: 800, troca: 0, investido: 4000, total: 2800, status: 'ATIVA', dataVenda: '2026-06-25' })
    expect(n.parcelas.map((p) => [p.numero, p.valor, p.pago, p.quitadaEm])).toEqual([[1, 500, 500, '2026-07-25'], [2, 500, 500, '2026-08-25'], [3, 500, 0, null], [4, 500, 0, null]])
  })
  it('a entrada vira um recibo de entrada; cada parcela paga, um recibo de parcela', () => {
    const n = um(v, base())
    expect(n.pagamentos.map((p) => [p.tipo, p.valorTotal])).toEqual([['ENTRADA', 800], ['PARCELA', 500], ['PARCELA', 500]])
    expect(n.pagamentos[0].resumo).toEqual({ tipo: 'ENTRADA', referencia: 'entrada', faltaDepois: 2000, proxima: { numero: 1, valor: 500, vencimento: '2026-07-25' }, restantes: 4, ficaDevendo: null })
    expect(n.pagamentos[1].resumo).toMatchObject({ tipo: 'PARCELAS', referencia: 'parcela 1/4', faltaDepois: 1500, restantes: 3 })
    expect(n.pagamentos[1].itens[0].antes).toEqual({ vencimento: '2026-07-25', vencimentoOriginal: null, desconto: 0, quitadaEm: null })
  })
  it('tudo pago: QUITADA', () => {
    const r = [rec(1, 'ENTRADA', 800, '2026-06-25'), ...[100, 101, 102, 103].map((id, i) => rec(1, 'PARCELA', 500, `2026-0${7 + i}-25`, id))]
    expect(um(v, { parcelas: parcelasPadrao(), recebimentos: r }).status).toBe('QUITADA')
  })
  it('sem indicador: % zero, mesmo que o antigo guarde um número', () => { expect(um(venda(1, { indicadorId: null, percentualParceiro: 50 }), base()).pct).toBe(0) })
  it('pagamento parcial deixa a parcela aberta com o que falta', () => {
    const n = um(v, { parcelas: parcelasPadrao(), recebimentos: [rec(1, 'PARCELA', 200, '2026-07-25', 100)] })
    expect(n.parcelas[0].pago).toBe(200); expect(n.pagamentos[0].resumo.ficaDevendo).toEqual({ numero: 1, valor: 300, vencimento: '2026-07-25' })
  })
  it('data remarcada guarda a original', () => {
    const n = um(v, { parcelas: [parc(100, 1, 1, '2026-08-30', 500, { vencimentoOriginal: '2026-08-15' }), ...parcelasPadrao().slice(1)] })
    expect(n.parcelas[0]).toMatchObject({ vencimento: '2026-08-30', vencimentoOriginal: '2026-08-15' })
  })
  it('reparcelamento do antigo fica anotado nas observações', () => {
    const n = um(venda(1, { observacoes: 'cliente pediu' }), { ...base(), ajustes: [{ id: 1, vendaId: 1, tipo: 'REPARCELAMENTO', criadoEm: '2026-09-24T17:20:31Z' }] })
    expect(n.observacoes).toBe('cliente pediu\nReparcelada em 24/09/2026 (histórico do sistema antigo).'); expect(n.avisos).toContain('reparcelada')
  })
})

describe('troca e desconto', () => {
  it('a troca é só o valor na venda: não gera recibo, mas conta no total', () => {
    const v = venda(1, { entrada: 0, trocaValor: 3700, trocaBemId: 2, valorTotal: 3700 + 2000 })
    const n = um(v, { parcelas: parcelasPadrao(), recebimentos: [rec(1, 'TROCA', 3700, '2026-06-25')] })
    expect(n).toMatchObject({ troca: 3700, trocaBemLegacyId: 2, total: 5700 }); expect(n.pagamentos).toEqual([])
  })
  it('desconto: a parcela quitada com dinheiro + desconto, e o desfazer volta ao estado de antes', () => {
    const v = venda(1, { entrada: 0, valorTotal: 1368 })
    const n = um(v, { parcelas: [parc(100, 1, 1, '2026-08-06', 1368)], recebimentos: [rec(1, 'PARCELA', 1000, '2026-08-06', 100, 368)] })
    expect(n.parcelas[0]).toMatchObject({ valor: 1368, pago: 1000, desconto: 368, quitadaEm: '2026-08-06' }); expect(n.status).toBe('QUITADA')
    expect(n.pagamentos[0].itens[0]).toMatchObject({ valor: 1000, antes: { desconto: 0, quitadaEm: null } })
  })
})

describe('segurança dos centavos', () => {
  const v = venda(1, { entrada: 0, valorTotal: 2000 })
  const conserva = (n: ReturnType<typeof um>, recs: VendaRecebimentoAntigo[]) => {
    const cash = recs.filter((r) => r.tipo === 'PARCELA').reduce((x, r) => x + r.valor, 0)
    expect(soma(n.parcelas.map((p) => p.pago))).toBe(soma([cash]))
    expect(soma(n.pagamentos.filter((p) => p.tipo === 'PARCELA').map((p) => p.valorTotal))).toBe(soma([cash]))
    for (const p of n.parcelas) expect(p.pago + p.desconto).toBeLessThanOrEqual(p.valor + 0.009)
  }
  it('pagamento acima do que falta na parcela: o excedente segue para a próxima', () => {
    const r = [rec(1, 'PARCELA', 700, '2026-07-25', 100)]; const n = um(v, { parcelas: parcelasPadrao(), recebimentos: r })
    expect(n.parcelas.map((p) => p.pago)).toEqual([500, 200, 0, 0]); expect(n.avisos).toContain('recebimento_dividido'); conserva(n, r)
  })
  it('parcela que não existe mais: rateado nas abertas, com aviso', () => {
    const r = [rec(1, 'PARCELA', 300, '2026-07-25', 999)]; const n = um(v, { parcelas: parcelasPadrao(), recebimentos: r })
    expect(n.parcelas[0].pago).toBe(300); expect(n.avisos).toContain('recebimento_realocado'); conserva(n, r)
  })
  it('recebeu mais do que a venda inteira: a última parcela cresce (nada se perde)', () => {
    const r = [rec(1, 'PARCELA', 2300, '2026-07-25', 100)]; const n = um(v, { parcelas: parcelasPadrao(), recebimentos: r })
    expect(n.avisos).toContain('recebimento_excedente'); expect(n.parcelas[3].valor).toBe(800); conserva(n, r)
  })
  it('total do antigo diferente da soma das partes: aviso (o novo usa a soma)', () => {
    const n = um(venda(1, { entrada: 0, valorTotal: 9999 }), { parcelas: parcelasPadrao() }); expect(n.avisos).toContain('total_diferente'); expect(n.total).toBe(2000)
  })
  it('entrada ou troca divergentes entre a venda e os recebimentos geram aviso', () => {
    expect(um(venda(1, { entrada: 800, valorTotal: 2800 }), { parcelas: parcelasPadrao(), recebimentos: [rec(1, 'ENTRADA', 700, '2026-06-25')] }).avisos).toContain('entrada_diferente')
    expect(um(venda(1, { entrada: 0, trocaValor: 100, valorTotal: 2100 }), { parcelas: parcelasPadrao() }).avisos).toContain('troca_diferente')
  })
  it('venda cancelada, pendente ou sem aparelho não é importada, com o motivo', () => {
    expect(transformarVenda(venda(1, { status: 'CANCELADA' }), estado({ vendas: [] })).erro).toMatch(/CANCELADA/)
    expect(transformarVenda(venda(1, { status: 'PENDENTE_APROVACAO' }), estado()).erro).toMatch(/PENDENTE/)
    expect(transformarVenda(venda(1, { bemId: 77 }), estado()).erro).toMatch(/aparelho/)
  })
  it('recebimentos fora de ordem são processados por data e depois por id', () => {
    const r = [rec(1, 'PARCELA', 500, '2026-08-25', 101), rec(1, 'PARCELA', 500, '2026-07-25', 100)]
    expect(um(v, { parcelas: parcelasPadrao(), recebimentos: r }).pagamentos.map((p) => p.data)).toEqual(['2026-07-25', '2026-08-25'])
  })
})
