import { beforeEach, describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import { ErroApi } from './clientes'
import { criarClientesFake } from './clientes.fake'
import { criarEmprestimosFake } from './emprestimos.fake'
import { criarEstoqueFake } from './estoque.fake'
import { criarIndicadoresFake } from './indicadores.fake'
import { criarRecebimentosFake } from './recebimentos.fake'
import { criarRepassesFake } from './repasses.fake'
import { criarVendasFake } from './vendas.fake'

// Mesmos cenários de back/tests/indicador-leitura.test.ts: a demonstração tem de se comportar como o backend.
const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const IND1: Sessao = { perfil: 'INDICADOR', indicadorId: 1 }
const IND2: Sessao = { perfil: 'INDICADOR', indicadorId: 2 }
const VEND: Sessao = { perfil: 'VENDEDOR', usuarioId: 2 }
const SO_DA_LOJA = ['custoNoDia', 'lucroTotal', 'seuLucro', 'lucroRealizado', 'capitalDeVolta', 'parteIndicador', 'capital', 'taxa', 'capitalAberto', 'investido']
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)

let clientes: ReturnType<typeof criarClientesFake>
let estoque: ReturnType<typeof criarEstoqueFake>
let indicadores: ReturnType<typeof criarIndicadoresFake>
let vendas: ReturnType<typeof criarVendasFake>
let emprestimos: ReturnType<typeof criarEmprestimosFake>
let recebimentos: ReturnType<typeof criarRecebimentosFake>
let repasses: ReturnType<typeof criarRepassesFake>
beforeEach(() => {
  clientes = criarClientesFake(); estoque = criarEstoqueFake(); indicadores = criarIndicadoresFake()
  vendas = criarVendasFake({ estoque, indicadores, clientes })
  emprestimos = criarEmprestimosFake({ clientes, indicadores })
  recebimentos = criarRecebimentosFake(vendas, emprestimos)
  repasses = criarRepassesFake({ vendas, emprestimos, indicadores, hoje: vendas._interno.hoje })
})
const idsVendas = async (s: Sessao) => (await vendas.listar(s, { limite: 100 })).itens.map((v) => v.id)
const idsEmp = async (s: Sessao) => (await emprestimos.listar(s, { limite: 100 })).itens.map((e) => e.id)
async function novaVenda(clienteId: number, indicadorId: number | null) {
  const ap = (await estoque.listar(ADMIN, { estado: 'DISPONIVEL', limite: 1 })).itens[0]
  return vendas.criar(ADMIN, { aparelhoId: ap.id, clienteId, preco: ap.preco, entrada: 600, parcelas: 4, diaVencimento: 10, indicadorId })
}

describe('vendas', () => {
  it('lista só as dele (a de outro indicador e a sem indicador não aparecem)', async () => {
    const todas = (await vendas.listar(ADMIN, { limite: 100 })).itens
    const dele = await idsVendas(IND1)
    expect(dele.length).toBeGreaterThan(0)
    expect(dele.sort()).toEqual(todas.filter((v) => v.indicador?.id === 1).map((v) => v.id).sort())
    expect(todas.some((v) => v.indicador?.id !== 1)).toBe(true) // há vendas dos outros para ficar de fora
  })
  it('mostra a parte dele e o %, e nunca custo, lucro, capital nem a parte da loja', async () => {
    const [v] = (await vendas.listar(IND1, { limite: 1 })).itens
    expect(v.percentualIndicador).toBeGreaterThan(0)
    expect(typeof v.suaParte).toBe('number'); expect(typeof v.jaLiberado).toBe('number')
    for (const campo of SO_DA_LOJA) expect(campo in v, campo).toBe(false)
    const doAdmin = await vendas.obter(ADMIN, v.id)
    expect(v.suaParte).toBe(doAdmin.parteIndicador)
  })
  it('a ficha: a dele abre; de outro, sem indicador e inexistente dão 404', async () => {
    const todas = (await vendas.listar(ADMIN, { limite: 100 })).itens
    const minha = todas.find((v) => v.indicador?.id === 1)!
    expect((await vendas.obter(IND1, minha.id)).id).toBe(minha.id)
    for (const outra of todas.filter((v) => v.indicador?.id !== 1)) expect((await falha(vendas.obter(IND1, outra.id)))?.status).toBe(404)
    expect((await falha(vendas.obter(IND1, 999999)))?.status).toBe(404)
  })
  it('libera conforme o dinheiro passa do capital: quitar a venda libera a parte inteira', async () => {
    const v = await novaVenda((await clientes.listar(ADMIN, { limite: 1 })).itens[0].id, 1)
    const antes = (await vendas.obter(IND1, v.id)).jaLiberado!
    for (const p of v.parcelas) await recebimentos.registrar(ADMIN, 'VENDA', v.id, { forma: 'PIX', parcela: p.numero, valor: p.valor })
    const depois = await vendas.obter(IND1, v.id)
    expect(depois.jaLiberado).toBeGreaterThan(antes)
    expect(depois.jaLiberado).toBe(depois.suaParte)
  })
  it('não vende nem retoma (403)', async () => {
    const [v] = (await vendas.listar(IND1, { limite: 1 })).itens
    expect((await falha(vendas.criar(IND1, { aparelhoId: 1, clienteId: 1 })))?.status).toBe(403)
    expect((await falha(vendas.retomar(IND1, v.id, {})))?.status).toBe(403)
  })
  it('o resumo traz só o a receber', async () => {
    expect(Object.keys(await vendas.resumo(IND1))).toEqual(['aReceber'])
  })
})

describe('empréstimos', () => {
  it('lista só os dele, com a parte dele e sem capital, taxa nem lucro', async () => {
    const todos = (await emprestimos.listar(ADMIN, { limite: 100 })).itens
    const dele = await idsEmp(IND1)
    expect(dele.sort()).toEqual(todos.filter((e) => e.indicador?.id === 1).map((e) => e.id).sort())
    for (const e of (await emprestimos.listar(IND1, { limite: 100 })).itens) {
      expect(typeof e.suaParte).toBe('number')
      for (const campo of SO_DA_LOJA) expect(campo in e, campo).toBe(false)
    }
  })
  it('a ficha: a dele abre; de outro, sem indicador e inexistente dão 404; não cria (403)', async () => {
    const todos = (await emprestimos.listar(ADMIN, { limite: 100 })).itens
    const meu = todos.find((e) => e.indicador?.id === 1)!
    expect((await emprestimos.obter(IND1, meu.id)).id).toBe(meu.id)
    for (const outro of todos.filter((e) => e.indicador?.id !== 1)) expect((await falha(emprestimos.obter(IND1, outro.id)))?.status).toBe(404)
    expect((await falha(emprestimos.criar(IND1, { clienteId: 1, modalidade: 'PARCELADO', capital: 100, taxa: 10, parcelas: 1 })))?.status).toBe(403)
  })
})

describe('cobranças', () => {
  it('vê as parcelas das operações dele (venda e empréstimo), e só elas', async () => {
    const r = await recebimentos.cobrancas(IND1, { aba: 'proximas', limite: 100 })
    const meusV = new Set(await idsVendas(IND1)); const meusE = new Set(await idsEmp(IND1))
    for (const l of [...r.itens, ...(await recebimentos.cobrancas(IND1, { aba: 'atrasadas', limite: 100 })).itens]) expect(l.tipo === 'VENDA' ? meusV.has(l.operacaoId) : meusE.has(l.operacaoId)).toBe(true)
    const tudoDele = (await recebimentos.cobrancas(IND1, { aba: 'atrasadas', limite: 100 })).total + r.total
    const tudoDoOutro = (await recebimentos.cobrancas(IND2, { aba: 'atrasadas', limite: 100 })).total + (await recebimentos.cobrancas(IND2, { aba: 'proximas', limite: 100 })).total
    expect(tudoDele).toBeGreaterThan(0)
    expect(tudoDele + tudoDoOutro).toBeLessThanOrEqual((await recebimentos.cobrancas(ADMIN, { aba: 'atrasadas', limite: 100 })).total + (await recebimentos.cobrancas(ADMIN, { aba: 'proximas', limite: 100 })).total)
  })
  it('NÃO registra recebimento, não vê recibo, pagamentos nem desfaz (403)', async () => {
    const [v] = (await vendas.listar(IND1, { limite: 1 })).itens
    expect((await falha(recebimentos.registrar(IND1, 'VENDA', v.id, { forma: 'PIX', parcela: 1, valor: 100 })))?.status).toBe(403)
    expect((await falha(recebimentos.pagamentos(IND1, 'VENDA', v.id)))?.status).toBe(403)
    expect((await falha(recebimentos.recibo(IND1, 1)))?.status).toBe(403)
    expect((await falha(recebimentos.desfazer(IND1, 1)))?.status).toBe(403)
  })
  it('vendedor continua sem ver cobranças (403)', async () => {
    expect((await falha(recebimentos.cobrancas(VEND, {})))?.status).toBe(403)
  })
})

describe('o próprio cadastro, os níveis e o repasse', () => {
  it('lê o próprio cadastro e nível; o de outro é 404; a lista de todos e as edições seguem fechadas', async () => {
    expect((await indicadores.obter(IND1, 1)).nivel).toBeTruthy()
    expect((await falha(indicadores.obter(IND1, 2)))?.status).toBe(404)
    expect((await falha(indicadores.obter(IND1, 999)))?.status).toBe(404)
    expect((await falha(indicadores.listar(IND1)))?.status).toBe(403)
    expect((await falha(indicadores.atualizar(IND1, 1, { pct: 1 })))?.status).toBe(403)
  })
  it('lê a tabela de níveis, mas não edita; vendedor não lê', async () => {
    const t = await indicadores.niveis(IND1)
    expect(t.niveis.length).toBeGreaterThan(0)
    expect((await falha(indicadores.salvarNiveis(IND1, t)))?.status).toBe(403)
    expect((await falha(indicadores.niveis(VEND)))?.status).toBe(403)
  })
  it('o repasse do indicador nunca traz o capital da loja, mas o do admin traz', async () => {
    const dele = await repasses.detalhe(IND1, 1)
    expect(dele.operacoes.length).toBeGreaterThan(0)
    for (const o of dele.operacoes) expect('investido' in o).toBe(false)
    expect((await repasses.detalhe(ADMIN, 1)).operacoes.every((o) => typeof o.investido === 'number')).toBe(true)
  })
})
