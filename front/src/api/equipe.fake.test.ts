import { beforeEach, describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { ErroApi } from './clientes'
import { criarClientesFake } from './clientes.fake'
import type { AprovacoesApi } from './aprovacoes'
import type { EquipeApi } from './equipe'
import { criarAprovacoesFake, criarEquipeFake, criarFechamentosFake } from './equipe.fake'
import { criarEstoqueFake, type EstoqueFake } from './estoque.fake'
import type { FechamentosApi } from './fechamentos'
import { criarIndicadoresFake } from './indicadores.fake'
import type { EntradaRecebimento, RecebimentosApi } from './recebimentos'
import { criarRecebimentosFake } from './recebimentos.fake'
import { criarVendasFake, type VendasFake } from './vendas.fake'

// Mesmos cenários de back/tests/equipe.test.ts: a demonstração tem de se comportar como o backend.
// O dia de hoje da demonstração é 08/10/2026. Cobrador 3 (Diego): carteira Fernanda(3), Carlos(4), Ana Paula(6), João(8).
const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const VEND: Sessao = { perfil: 'VENDEDOR', usuarioId: 2 }
const COBR: Sessao = { perfil: 'COBRADOR', usuarioId: 3 }
const COBR2: Sessao = { perfil: 'COBRADOR', usuarioId: 77 }
const IND: Sessao = { perfil: 'INDICADOR', indicadorId: 1 }

let vendas: VendasFake
let estoque: EstoqueFake
let recebimentos: RecebimentosApi
let aprovacoes: AprovacoesApi
let fechamentos: FechamentosApi
let equipe: EquipeApi
beforeEach(() => {
  estoque = criarEstoqueFake()
  vendas = criarVendasFake({ estoque, indicadores: criarIndicadoresFake(), clientes: criarClientesFake() })
  recebimentos = criarRecebimentosFake(vendas)
  aprovacoes = criarAprovacoesFake(vendas)
  fechamentos = criarFechamentosFake(vendas)
  equipe = criarEquipeFake(vendas)
})
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)

/** Venda de 3.000: entrada 600, 4 parcelas de 840 (10/11, 10/12, 10/01, 10/02), de um cliente da carteira do Diego. */
async function venda(clienteId = 3): Promise<number> {
  const a = await estoque.criar(ADMIN, { modelo: 'iPhone 13', gb: 128, cor: 'Preto', preco: 3000, custo: 2000 })
  return (await vendas.criar(ADMIN, { aparelhoId: a.id, clienteId, preco: 3000, entrada: 600, parcelas: 4, diaVencimento: 10 })).id
}
const receber = (s: Sessao, vendaId: number, e: Partial<EntradaRecebimento>) => recebimentos.registrar(s, 'VENDA', vendaId, { parcela: 1, valor: 840, forma: 'PIX', ...e })
const pedir = (s: Sessao, vendaId: number, e: Partial<{ parcela: number; valor: number; motivo: string }> = {}) => aprovacoes.pedirDesconto(s, { alvo: 'VENDA', operacaoId: vendaId, parcela: 1, valor: 100, motivo: 'Cliente pediu pra arredondar', ...e })
const parcela = async (vendaId: number, n: number) => (await vendas.obter(ADMIN, vendaId)).parcelas[n - 1]

describe('pedir desconto', () => {
  it('só o cobrador pede (403 para admin, vendedor e indicador)', async () => {
    const v = await venda()
    for (const s of [ADMIN, VEND, IND]) expect((await falha(pedir(s, v)))?.status).toBe(403)
  })
  it('nasce PENDENTE com tudo o que o admin precisa ver; a parcela não muda enquanto espera', async () => {
    const v = await venda()
    const r = await pedir(COBR, v, { valor: 150 })
    expect(r).toMatchObject({ tipo: 'DESCONTO', status: 'PENDENTE', alvo: 'VENDA', operacaoId: v, parcela: 1, nParcelas: 4, valor: 150, motivo: 'Cliente pediu pra arredondar', cliente: { nome: 'Fernanda Almeida' }, aparelho: 'iPhone 13', solicitante: { nome: 'Diego Ramos' }, respondidoPor: null })
    expect((await parcela(v, 1)).desconto).toBe(0)
  })
  it.each([['valor zero', { valor: 0 }], ['valor negativo', { valor: -5 }], ['motivo vazio', { motivo: '' }], ['motivo curto', { motivo: 'ab' }], ['motivo enorme', { motivo: 'x'.repeat(501) }], ['desconto maior que a parcela', { valor: 840.01 }]])('recusa %s (400)', async (_n, m) => {
    const v = await venda()
    expect((await falha(pedir(COBR, v, m)))?.status).toBe(400)
  })
  it('só um pendente por parcela (409); venda de outra carteira ou inexistente é 404; parcela paga é 409', async () => {
    const v = await venda()
    await pedir(COBR, v)
    expect((await falha(pedir(COBR, v)))?.codigo).toBe('PEDIDO_JA_EXISTE')
    expect((await falha(pedir(COBR2, v)))?.status).toBe(404)
    expect((await falha(pedir(COBR, 999999)))?.status).toBe(404)
    await receber(ADMIN, v, { parcela: 2 })
    expect((await falha(pedir(COBR, v, { parcela: 2 })))?.codigo).toBe('PARCELA_PAGA')
  })
})

describe('listar, aprovar e recusar', () => {
  it('o admin vê todos e o cobrador só os dele; vendedor e indicador, 403; filtra por status', async () => {
    const v = await venda(); await pedir(COBR, v)
    const adm = await aprovacoes.listar(ADMIN, { limite: 100 })
    expect(adm.itens.length).toBeGreaterThanOrEqual(3) // 2 dos dados de exemplo + o novo
    expect((await aprovacoes.listar(COBR, { limite: 100 })).itens.every((x) => x.solicitante.nome === 'Diego Ramos')).toBe(true)
    expect((await aprovacoes.listar(COBR2, { limite: 100 })).itens).toHaveLength(0)
    for (const s of [VEND, IND]) expect((await falha(aprovacoes.listar(s, {})))?.status).toBe(403)
    expect((await aprovacoes.listar(ADMIN, { status: 'PENDENTE', limite: 100 })).itens.every((x) => x.status === 'PENDENTE')).toBe(true)
  })
  it('só o admin responde', async () => {
    const v = await venda(); const p = await pedir(COBR, v)
    for (const s of [COBR, VEND, IND]) { expect((await falha(aprovacoes.aprovar(s, p.id)))?.status).toBe(403); expect((await falha(aprovacoes.recusar(s, p.id)))?.status).toBe(403) }
  })
  it('aprovar aplica o desconto; o que cobre o resto quita a parcela; quitar a última fecha a venda', async () => {
    const v = await venda()
    const p = await pedir(COBR, v, { valor: 100 })
    expect(await aprovacoes.aprovar(ADMIN, p.id)).toMatchObject({ status: 'APROVADO', respondidoPor: 'Geovane Cataneo' })
    expect(await parcela(v, 1)).toMatchObject({ desconto: 100, falta: 740 })
    const p2 = await pedir(COBR, v, { parcela: 2, valor: 840 })
    await aprovacoes.aprovar(ADMIN, p2.id)
    expect((await parcela(v, 2)).quitadaEm).not.toBeNull()
    for (const n of [1, 3, 4]) { const f = (await parcela(v, n)).falta; if (f > 0) await aprovacoes.aprovar(ADMIN, (await pedir(COBR, v, { parcela: n, valor: f })).id) }
    expect((await vendas.obter(ADMIN, v)).status).toBe('QUITADA')
  })
  it('responder de novo é 409; inexistente é 404', async () => {
    const v = await venda(); const p = await pedir(COBR, v)
    await aprovacoes.aprovar(ADMIN, p.id)
    expect((await falha(aprovacoes.aprovar(ADMIN, p.id)))?.codigo).toBe('PEDIDO_JA_RESPONDIDO')
    expect((await falha(aprovacoes.recusar(ADMIN, p.id)))?.codigo).toBe('PEDIDO_JA_RESPONDIDO')
    expect((await falha(aprovacoes.aprovar(ADMIN, 999999)))?.status).toBe(404)
  })
  it('a parcela mudou depois do pedido: aprovar é 409 e o pedido segue pendente (dá para recusar)', async () => {
    const v = await venda(); const p = await pedir(COBR, v, { valor: 700 })
    await receber(ADMIN, v, { valor: 500, resto: 'FICA', novoVencimento: '2026-11-10' })
    expect((await falha(aprovacoes.aprovar(ADMIN, p.id)))?.codigo).toBe('PEDIDO_DESATUALIZADO')
    expect((await parcela(v, 1)).desconto).toBe(0)
    expect((await aprovacoes.recusar(ADMIN, p.id, 'Mudou')).status).toBe('RECUSADO')
  })
  it('recusar guarda o motivo e não mexe na parcela; depois dá para pedir de novo', async () => {
    const v = await venda(); const p = await pedir(COBR, v)
    expect(await aprovacoes.recusar(ADMIN, p.id, 'Margem apertada')).toMatchObject({ status: 'RECUSADO', resposta: 'Margem apertada' })
    expect((await parcela(v, 1)).desconto).toBe(0)
    expect((await pedir(COBR, v)).status).toBe('PENDENTE')
  })
})

describe('pedir desconto ao receber', () => {
  it('o cobrador recebe parte e pede desconto do resto: pagamento lançado, parcela aberta, pedido criado; aprovar quita', async () => {
    const v = await venda()
    const r = await receber(COBR, v, { valor: 540, resto: 'FICA', novoVencimento: '2026-10-15', pedirDesconto: { motivo: 'Cliente só tinha 540' } })
    expect(r.efeitos).toEqual([{ tipo: 'FICA', numero: 1, resta: 300, vencimento: '2026-10-15' }])
    expect(r.pedidoDescontoId).not.toBeNull()
    const ped = (await aprovacoes.listar(ADMIN, { status: 'PENDENTE', limite: 100 })).itens.find((x) => x.id === r.pedidoDescontoId)!
    expect(ped).toMatchObject({ valor: 300, motivo: 'Cliente só tinha 540', alvo: 'VENDA', operacaoId: v })
    await aprovacoes.aprovar(ADMIN, ped.id)
    expect(await parcela(v, 1)).toMatchObject({ pago: 540, desconto: 300, falta: 0 })
  })
  it('só pede deixando o resto devendo; desconto direto é 403; o admin não "pede"; pagou tudo não tem o que pedir', async () => {
    const v = await venda()
    expect((await falha(receber(COBR, v, { valor: 540, resto: 'DESCONTO' })))?.status).toBe(403)
    expect((await falha(receber(COBR, v, { valor: 540, pedirDesconto: { motivo: 'abc' } })))?.status).toBe(400)
    expect((await falha(receber(ADMIN, v, { valor: 540, resto: 'FICA', novoVencimento: '2026-10-15', pedirDesconto: { motivo: 'abc' } })))?.status).toBe(403)
    expect((await falha(receber(COBR, v, { valor: 540, resto: 'FICA', novoVencimento: '2026-10-15', pedirDesconto: { motivo: 'a' } })))?.status).toBe(400)
    expect((await falha(receber(COBR, v, { valor: 840, resto: 'FICA', pedirDesconto: { motivo: 'sem sentido' } })))?.status).toBe(400)
  })
  it('já existe pedido pendente: 409 e o recebimento NÃO é lançado (tudo ou nada)', async () => {
    const v = await venda(); await pedir(COBR, v)
    const antes = vendas._interno.transacoes.length
    expect((await falha(receber(COBR, v, { valor: 540, resto: 'FICA', novoVencimento: '2026-10-15', pedirDesconto: { motivo: 'outro pedido' } })))?.status).toBe(409)
    expect(vendas._interno.transacoes.length).toBe(antes)
  })
})

describe('caixa do dia e fechamento', () => {
  it('só o cobrador tem caixa e fecha o dia', async () => {
    for (const s of [ADMIN, VEND, IND]) { expect((await falha(fechamentos.hoje(s)))?.status).toBe(403); expect((await falha(fechamentos.fechar(s)))?.status).toBe(403) }
  })
  it('o caixa soma o que ele recebeu hoje, por forma, sem os desfeitos nem os do admin', async () => {
    const [a, b, c] = [await venda(), await venda(), await venda()]
    await receber(COBR, a, { forma: 'DINHEIRO' }); await receber(COBR, b, { forma: 'PIX' })
    const feito = (await receber(COBR, c, { valor: 500, forma: 'CARTAO', resto: 'FICA', novoVencimento: '2026-10-20' })).recibo.id
    await receber(ADMIN, a, { parcela: 2, forma: 'DINHEIRO' })
    let caixa = await fechamentos.hoje(COBR)
    expect(caixa).toMatchObject({ data: '2026-10-08', dinheiro: 840, pix: 840, cartao: 500, total: 2180, fechamento: null })
    expect(caixa.recebimentos).toHaveLength(3)
    await recebimentos.desfazer(COBR, feito)
    caixa = await fechamentos.hoje(COBR)
    expect(caixa).toMatchObject({ cartao: 0, total: 1680 })
  })
  it('fechar soma sozinho, uma vez por dia; depois o cobrador não recebe nem desfaz; o admin recebe mas não desfaz o dia fechado', async () => {
    const v = await venda()
    const rec = (await receber(COBR, v, { forma: 'DINHEIRO' })).recibo.id
    expect(await fechamentos.fechar(COBR)).toMatchObject({ data: '2026-10-08', totalDinheiro: 840, total: 840, status: 'PENDENTE', usuario: { nome: 'Diego Ramos' } })
    expect((await falha(fechamentos.fechar(COBR)))?.codigo).toBe('DIA_JA_FECHADO')
    expect((await falha(receber(COBR, v, { parcela: 2 })))?.codigo).toBe('DIA_FECHADO')
    expect((await falha(recebimentos.desfazer(COBR, rec)))?.codigo).toBe('DIA_FECHADO')
    expect((await falha(recebimentos.desfazer(ADMIN, rec)))?.codigo).toBe('DIA_FECHADO')
    expect((await receber(ADMIN, v, { parcela: 2 })).recibo.valor).toBe(840)
  })
  it('o admin vê e confere uma vez (os dados de exemplo trazem um de ontem); o cobrador só vê os dele; reabrir só o pendente', async () => {
    const lista = await fechamentos.listar(ADMIN, { limite: 100 })
    const ontem = lista.itens.find((f) => f.data === '2026-10-07')!
    expect(ontem).toMatchObject({ status: 'PENDENTE', usuario: { nome: 'Diego Ramos' }, total: 850 })
    expect((await fechamentos.listar(COBR2, {})).itens).toHaveLength(0)
    for (const s of [COBR, VEND, IND]) expect((await falha(fechamentos.conferir(s, ontem.id)))?.status).toBe(403)
    expect(await fechamentos.conferir(ADMIN, ontem.id)).toMatchObject({ status: 'CONFERIDO', conferidoPor: 'Geovane Cataneo' })
    expect((await falha(fechamentos.conferir(ADMIN, ontem.id)))?.codigo).toBe('JA_CONFERIDO')
    expect((await falha(fechamentos.reabrir(ADMIN, ontem.id)))?.codigo).toBe('JA_CONFERIDO')
    expect((await falha(fechamentos.conferir(ADMIN, 999999)))?.status).toBe(404)
  })
  it('reabrir o pendente: o cobrador volta a lançar e fecha de novo com os totais novos', async () => {
    const v = await venda()
    await receber(COBR, v, { forma: 'PIX' })
    const f = await fechamentos.fechar(COBR)
    expect((await falha(fechamentos.reabrir(COBR, f.id)))?.status).toBe(403)
    await fechamentos.reabrir(ADMIN, f.id)
    await receber(COBR, v, { parcela: 2, forma: 'DINHEIRO' })
    expect(await fechamentos.fechar(COBR)).toMatchObject({ totalPix: 840, totalDinheiro: 840, total: 1680 })
  })
})

describe('equipe', () => {
  it('só o admin vê e gerencia a equipe', async () => {
    for (const s of [VEND, COBR, IND]) {
      expect((await falha(equipe.listar(s)))?.status).toBe(403)
      expect((await falha(equipe.convidar(s, { nome: 'Fulano', email: 'f@t.com', perfil: 'VENDEDOR' })))?.status).toBe(403)
      expect((await falha(equipe.atualizar(s, 2, { ativo: false })))?.status).toBe(403)
    }
  })
  it('lista as pessoas com carteira, atrasos, recebido no mês e pedidos pendentes; admin primeiro, depois cobradores e vendedores', async () => {
    await receber(COBR, await venda(), { valor: 840 })
    const lista = await equipe.listar(ADMIN)
    expect(lista.map((p) => p.perfil)).toEqual(['ADMIN', 'COBRADOR', 'VENDEDOR'])
    const diego = lista.find((p) => p.nome === 'Diego Ramos')!
    expect(diego).toMatchObject({ carteira: 4, pedidosPendentes: 3 })
    expect(diego.comAtraso).toBeGreaterThan(0)
    expect(diego.recebidoNoMes).toBe(840)
    expect(lista.find((p) => p.nome === 'Bruna Teixeira')!.carteira).toBe(4)
  })
  it('convida: senha temporária mostrada uma vez; e-mail repetido é 409; perfil de admin é recusado; dados inválidos são 400', async () => {
    const r = await equipe.convidar(ADMIN, { nome: '  Ana   Lima ', email: 'Ana@Loja.com', perfil: 'COBRADOR', fone: '(11) 98123-4455' })
    expect(r.email).toBe('ana@loja.com')
    expect(r.senhaTemporaria.length).toBeGreaterThanOrEqual(10)
    expect((await equipe.listar(ADMIN)).find((p) => p.id === r.id)).toMatchObject({ nome: 'Ana Lima', fone: '11981234455', perfil: 'COBRADOR' })
    expect((await falha(equipe.convidar(ADMIN, { nome: 'Outra', email: 'ana@loja.com', perfil: 'VENDEDOR' })))?.codigo).toBe('EMAIL_EM_USO')
    for (const perfil of ['ADMIN', 'INDICADOR', 'DONO']) expect((await falha(equipe.convidar(ADMIN, { nome: 'Fulano', email: `f${perfil}@t.com`, perfil: perfil as never })))?.status).toBe(400)
    expect((await falha(equipe.convidar(ADMIN, { nome: 'F', email: 'f1@t.com', perfil: 'COBRADOR' })))?.status).toBe(400)
    expect((await falha(equipe.convidar(ADMIN, { nome: 'Fulano', email: 'nao-e-email', perfil: 'COBRADOR' })))?.status).toBe(400)
    expect((await falha(equipe.convidar(ADMIN, { nome: 'Fulano', email: 'f2@t.com', perfil: 'COBRADOR', fone: '123' })))?.status).toBe(400)
  })
  it('edita, desativa e reativa; não mexe em administrador, nem desativa a si mesmo; 404 e validações', async () => {
    expect((await equipe.atualizar(ADMIN, 2, { nome: 'Bruna T. Souza', fone: '(11) 90000-0000' })).nome).toBe('Bruna T. Souza')
    expect((await equipe.atualizar(ADMIN, 2, { ativo: false })).ativo).toBe(false)
    expect((await equipe.atualizar(ADMIN, 2, { ativo: true })).ativo).toBe(true)
    expect((await falha(equipe.atualizar(ADMIN, 1, { ativo: false })))?.status).toBe(403)
    expect((await falha(equipe.atualizar(ADMIN, 999999, { ativo: false })))?.status).toBe(404)
    expect((await falha(equipe.atualizar(ADMIN, 2, { ativo: 'nao' as never })))?.status).toBe(400)
    expect((await falha(equipe.atualizar(ADMIN, 2, { nome: ' ' })))?.status).toBe(400)
    expect((await falha(equipe.atualizar(ADMIN, 2, { fone: 'abc' })))?.status).toBe(400)
  })
})
