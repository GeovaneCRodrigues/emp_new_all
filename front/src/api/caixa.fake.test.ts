import { beforeEach, describe, expect, it } from 'vitest'
import type { Sessao } from '@/domain/escopo'
import type { CaixaApi, CaixaLojaApi, EntradaLancamento } from './caixa'
import { criarCaixaFake } from './caixa.fake'
import { ErroApi } from './clientes'
import { criarClientesFake } from './clientes.fake'
import { criarEmprestimosFake, type EmprestimosFake } from './emprestimos.fake'
import { criarEstoqueFake, type EstoqueFake } from './estoque.fake'
import { criarIndicadoresFake } from './indicadores.fake'
import { criarRecebimentosFake } from './recebimentos.fake'
import type { RecebimentosApi } from './recebimentos'
import { criarRepassesFake } from './repasses.fake'
import type { RepassesApi } from './repasses'
import { criarVendasFake, type VendasFake } from './vendas.fake'

// Mesmos cenários de back/tests/caixa.test.ts: a demonstração tem de se comportar como o backend. O "hoje" da demonstração é 08/10/2026.
const ADMIN: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const OUTROS: Sessao[] = [{ perfil: 'VENDEDOR', usuarioId: 2 }, { perfil: 'COBRADOR', usuarioId: 3 }, { perfil: 'INDICADOR', indicadorId: 1 }]
const HOJE = '2026-10-08'

let api: CaixaApi, vendas: VendasFake, estoque: EstoqueFake, emprestimos: EmprestimosFake, recebimentos: RecebimentosApi, repasses: RepassesApi
beforeEach(() => {
  estoque = criarEstoqueFake()
  const indicadores = criarIndicadoresFake()
  const clientes = criarClientesFake()
  vendas = criarVendasFake({ estoque, indicadores, clientes })
  emprestimos = criarEmprestimosFake({ clientes, indicadores })
  recebimentos = criarRecebimentosFake(vendas, emprestimos)
  repasses = criarRepassesFake({ vendas, emprestimos, indicadores, hoje: HOJE })
  api = criarCaixaFake({ vendas, emprestimos, estoque, repasses })
})
const falha = async (p: Promise<unknown>) => p.then(() => null, (e: ErroApi) => e)
const tudo = async (): Promise<CaixaLojaApi> => { const a = await api.ver(ADMIN, { limite: 100 }); return { ...a, itens: a.itens, total: a.total } }
async function todos() { const itens = []; for (let p = 1; ; p++) { const r = await api.ver(ADMIN, { pagina: p, limite: 100 }); itens.push(...r.itens); if (itens.length >= r.total) return itens } }
const lanc = (e: Partial<EntradaLancamento>) => api.lancar(ADMIN, { tipo: 'APORTE', valor: 100, ...e })
const venda = async (cliente = 3) => {
  const a = await estoque.criar(ADMIN, { modelo: 'iPhone 13', gb: 128, cor: 'Preto', preco: 3000, custo: 2000 })
  return (await vendas.criar(ADMIN, { aparelhoId: a.id, clienteId: cliente, preco: 3000, entrada: 600, parcelas: 4, diaVencimento: 10 })).id
}

describe('caixa da loja (demonstração)', () => {
  it('começa com o saldo de abertura como aporte, e o resumo é do mês de hoje', async () => {
    const c = await tudo()
    expect(c).toMatchObject({ hoje: HOJE, mes: '2026-10', marcoZero: '2026-01-01' })
    expect(c.itens.some((m) => m.categoria === 'APORTE' && m.titulo === 'Saldo de abertura' && m.valor === 100000 && m.manualId !== null)).toBe(true)
  })
  it('o saldo é entradas − saídas do extrato inteiro, sem erro de centavos', async () => {
    const itens = await todos()
    const soma = Math.round(itens.reduce((t, m) => t + (m.entrada ? m.valor : -m.valor), 0) * 100) / 100
    expect((await api.ver(ADMIN)).saldo).toBe(soma)
  })
  it('entrou e saiu do mês só contam o mês de hoje', async () => {
    const itens = await todos(); const c = await api.ver(ADMIN)
    const mes = itens.filter((m) => m.data.slice(0, 7) === '2026-10')
    expect(c.entrouMes).toBe(Math.round(mes.filter((m) => m.entrada).reduce((t, m) => t + m.valor, 0) * 100) / 100)
    expect(c.saiuMes).toBe(Math.round(mes.filter((m) => !m.entrada).reduce((t, m) => t + m.valor, 0) * 100) / 100)
  })
  it('o extrato vem do mais novo para o mais antigo e pagina com o total certo', async () => {
    const todo = await todos(); const p1 = await api.ver(ADMIN, { limite: 5 }), p2 = await api.ver(ADMIN, { limite: 5, pagina: 2 })
    expect(p1.total).toBe(todo.length); expect(p1.itens).toEqual(todo.slice(0, 5)); expect(p2.itens).toEqual(todo.slice(5, 10))
    expect(todo.map((m) => m.data)).toEqual([...todo.map((m) => m.data)].sort().reverse())
    expect((await api.ver(ADMIN, { limite: 99999 })).limite).toBe(100); expect((await api.ver(ADMIN, { limite: 0, pagina: -3 }))).toMatchObject({ limite: 25, pagina: 1 })
  })
  it('só o administrador: vendedor, cobrador e indicador levam 403 em tudo', async () => {
    for (const s of OUTROS) {
      expect((await falha(api.ver(s)))?.status).toBe(403)
      expect((await falha(api.lancar(s, { tipo: 'APORTE', valor: 1 })))?.status).toBe(403)
      expect((await falha(api.editar(s, 1, { valor: 1 })))?.status).toBe(403)
      expect((await falha(api.excluir(s, 1)))?.status).toBe(403)
    }
  })

  describe('o que entra e o que sai', () => {
    it('um recebimento entra com o cliente, o aparelho e a parcela; desfazer tira de volta', async () => {
      const v = await venda(); const antes = (await api.ver(ADMIN)).saldo
      const r = await recebimentos.registrar(ADMIN, 'VENDA', v, { parcela: 1, valor: 840, forma: 'PIX' })
      const c = await tudo()
      const m = c.itens.find((i) => i.categoria === 'RECEBIMENTO' && i.valor === 840)!
      expect(m).toMatchObject({ entrada: true, sub: expect.stringContaining('iPhone 13 · parcela 1/4 · Pix') })
      expect(c.saldo).toBe(Math.round((antes + 840) * 100) / 100)
      await recebimentos.desfazer(ADMIN, r.recibo.id)
      expect((await api.ver(ADMIN)).saldo).toBe(antes)
    })
    it('a entrada da venda entra como "Entrada · cliente"', async () => {
      await venda()
      expect((await tudo()).itens.some((i) => i.categoria === 'ENTRADA_VENDA' && i.titulo.startsWith('Entrada · ') && i.valor === 600 && i.entrada)).toBe(true)
    })
    it('empréstimo novo SAI do caixa (o capital)', async () => {
      const antes = (await api.ver(ADMIN)).saldo
      await emprestimos.criar(ADMIN, { clienteId: 3, capital: 1000, modalidade: 'PARCELADO', taxa: 30, parcelas: 4, periodicidade: 'MENSAL', primeiroVencimento: '2026-11-10' } as never)
      const c = await tudo()
      expect(c.itens.some((i) => i.categoria === 'EMPRESTIMO' && i.valor === 1000 && !i.entrada)).toBe(true)
      expect(c.saldo).toBe(Math.round((antes - 1000) * 100) / 100)
    })
    it('compra de aparelho SAI (custo + extras); aparelho que veio de troca não', async () => {
      const antes = await tudo()
      await estoque.criar(ADMIN, { modelo: 'iPhone 14', gb: 128, cor: 'Azul', preco: 3500, custo: 3000, extras: 150 })
      const c = await tudo()
      expect(c.itens.find((i) => i.categoria === 'COMPRA' && i.titulo === 'Compra · iPhone 14 128 GB')).toMatchObject({ valor: 3150, entrada: false, sub: 'Azul' })
      expect(c.saldo).toBe(Math.round((antes.saldo - 3150) * 100) / 100)
    })
    it('aparelho encomendado ainda não saiu do caixa; o que veio de troca nunca sai', async () => {
      const antes = await tudo()
      await estoque.criar(ADMIN, { modelo: 'iPhone 15', gb: 256, cor: 'Preto', preco: 5000, custo: 4000, estado: 'ENCOMENDADO', paraClienteId: 3 })
      await estoque.criar(ADMIN, { modelo: 'iPhone 11', gb: 64, cor: 'Branco', preco: 1500, custo: 1000, origem: 'TROCA' })
      const c = await tudo()
      expect(c.itens.filter((m) => m.categoria === 'COMPRA')).toHaveLength(antes.itens.filter((m) => m.categoria === 'COMPRA').length)
      expect(c.saldo).toBe(antes.saldo)
    })
    it('repasse pago ao indicador SAI', async () => {
      const resumo = await repasses.resumo(ADMIN); const quem = resumo.find((r) => r.resumo.aPagar > 0)
      expect(quem, 'a demonstração precisa ter um indicador com repasse a pagar').toBeDefined()
      if (!quem) return
      const antes = (await api.ver(ADMIN)).saldo
      await repasses.pagar(ADMIN, quem.indicador.id, { valor: quem.resumo.aPagar, forma: 'PIX' })
      const c = await tudo()
      expect(c.itens.some((i) => i.categoria === 'REPASSE' && i.titulo === `Repasse · ${quem.indicador.nome}` && !i.entrada)).toBe(true)
      expect(c.saldo).toBe(Math.round((antes - quem.resumo.aPagar) * 100) / 100)
    })
  })

  describe('marco zero: só conta a partir do primeiro aporte ou retirada', () => {
    it('apagando o aporte de abertura e lançando outro mais novo, o que veio antes sai da conta', async () => {
      const antes = await tudo()
      const abertura = antes.itens.find((m) => m.titulo === 'Saldo de abertura')!
      await api.excluir(ADMIN, abertura.manualId!)
      expect((await api.ver(ADMIN)).marcoZero).toBeNull() // sem lançamento, conta tudo
      await lanc({ tipo: 'APORTE', valor: 1000, data: '2026-10-01' })
      const c = await tudo()
      expect(c.marcoZero).toBe('2026-10-01')
      expect(c.itens.every((m) => m.data >= '2026-10-01')).toBe(true)
    })
    it('despesa não define o marco; retirada define', async () => {
      const abertura = (await tudo()).itens.find((m) => m.titulo === 'Saldo de abertura')!
      await api.excluir(ADMIN, abertura.manualId!)
      await lanc({ tipo: 'DESPESA', valor: 50, data: '2026-02-01', obs: 'aluguel' })
      expect((await api.ver(ADMIN)).marcoZero).toBeNull()
      await lanc({ tipo: 'RETIRADA', valor: 10, data: '2026-03-01' })
      expect((await api.ver(ADMIN)).marcoZero).toBe('2026-03-01')
    })
  })

  describe('lançar, editar e excluir', () => {
    it('lança com a data de hoje por padrão e mexe no saldo', async () => {
      const antes = (await api.ver(ADMIN)).saldo
      const l = await api.lancar(ADMIN, { tipo: 'APORTE', valor: 7500.5, obs: '  reforço ' })
      expect(l).toMatchObject({ tipo: 'APORTE', valor: 7500.5, data: HOJE, obs: 'reforço' })
      expect((await api.ver(ADMIN)).saldo).toBe(Math.round((antes + 7500.5) * 100) / 100)
    })
    it('retirada e despesa diminuem; o título é a observação, ou o nome do tipo', async () => {
      const antes = (await api.ver(ADMIN)).saldo
      await lanc({ tipo: 'DESPESA', valor: 90, obs: 'internet' }); await lanc({ tipo: 'RETIRADA', valor: 10 })
      const c = await tudo()
      expect(c.saldo).toBe(Math.round((antes - 100) * 100) / 100)
      expect(c.itens.find((m) => m.categoria === 'DESPESA')).toMatchObject({ titulo: 'internet', sub: 'Despesa', entrada: false })
      expect(c.itens.find((m) => m.categoria === 'RETIRADA')).toMatchObject({ titulo: 'Retirada', sub: 'Retirada' })
    })
    it('edita só o que veio; mudar o tipo muda o sinal no saldo', async () => {
      const l = await lanc({ valor: 100, data: '2026-10-01', obs: 'a' })
      expect(await api.editar(ADMIN, l.id, { valor: 250 })).toMatchObject({ tipo: 'APORTE', valor: 250, data: '2026-10-01', obs: 'a' })
      const antes = (await api.ver(ADMIN)).saldo
      await api.editar(ADMIN, l.id, { tipo: 'RETIRADA' })
      expect((await api.ver(ADMIN)).saldo).toBe(Math.round((antes - 500) * 100) / 100)
    })
    it('apagar a observação de aporte vale; de despesa não', async () => {
      const a = await lanc({ obs: 'x' }); expect((await api.editar(ADMIN, a.id, { obs: '' })).obs).toBeNull()
      const d = await lanc({ tipo: 'DESPESA', obs: 'x' }); expect((await falha(api.editar(ADMIN, d.id, { obs: '  ' })))?.status).toBe(400)
    })
    it('exclui; excluir de novo ou editar um id que não existe é 404', async () => {
      const l = await lanc({}); const antes = (await api.ver(ADMIN)).saldo
      await api.excluir(ADMIN, l.id)
      expect((await api.ver(ADMIN)).saldo).toBe(Math.round((antes - 100) * 100) / 100)
      expect((await falha(api.excluir(ADMIN, l.id)))?.status).toBe(404)
      expect((await falha(api.editar(ADMIN, 999999, { valor: 1 })))?.status).toBe(404)
    })
    it.each([
      ['tipo ausente', { valor: 1 }], ['tipo inválido', { tipo: 'DOACAO', valor: 1 }], ['valor ausente', { tipo: 'APORTE' }], ['valor zero', { tipo: 'APORTE', valor: 0 }],
      ['valor negativo', { tipo: 'APORTE', valor: -5 }], ['valor em texto', { tipo: 'APORTE', valor: '10' }], ['valor enorme', { tipo: 'APORTE', valor: 2e9 }],
      ['data mal escrita', { tipo: 'APORTE', valor: 1, data: '10/10/2026' }], ['data impossível', { tipo: 'APORTE', valor: 1, data: '2026-02-30' }], ['data no futuro', { tipo: 'APORTE', valor: 1, data: '2026-10-09' }],
      ['data antiga demais', { tipo: 'APORTE', valor: 1, data: '1999-12-31' }], ['obs longa', { tipo: 'APORTE', valor: 1, obs: 'x'.repeat(201) }], ['obs que não é texto', { tipo: 'APORTE', valor: 1, obs: 7 }],
      ['despesa sem descrição', { tipo: 'DESPESA', valor: 1 }],
    ])('lançamento inválido (%s) é 400 e não grava nada', async (_n, corpo) => {
      const antes = (await api.ver(ADMIN)).total
      expect((await falha(api.lancar(ADMIN, corpo as never)))?.status).toBe(400)
      expect((await api.ver(ADMIN)).total).toBe(antes)
    })
    it('hoje e 200 letras são aceitos; edição inválida não altera', async () => {
      await api.lancar(ADMIN, { tipo: 'APORTE', valor: 1, data: HOJE, obs: 'x'.repeat(200) })
      const l = await lanc({ valor: 100 })
      for (const c of [{ valor: -1 }, { data: '2027-01-01' }, { tipo: 'X' as never }]) expect((await falha(api.editar(ADMIN, l.id, c)))?.status).toBe(400)
      expect((await api.editar(ADMIN, l.id, {})).valor).toBe(100)
    })
  })
})

describe('busca no extrato (mesmas regras do backend)', () => {
  it('acha pela descrição do lançamento, sem acento nem maiúscula', async () => {
    await lanc({ tipo: 'DESPESA', valor: 80, obs: 'Conta de LUZ da Loja' })
    const r = await api.ver(ADMIN, { busca: 'luz loja', limite: 100 })
    expect(r.itens.map((m) => m.titulo)).toEqual(['Conta de LUZ da Loja'])
    expect(r.total).toBe(1)
  })
  it('busca em branco traz o extrato inteiro; sem resultado fica vazio', async () => {
    const todo = (await api.ver(ADMIN, { limite: 100 })).total
    expect((await api.ver(ADMIN, { busca: '  ', limite: 100 })).total).toBe(todo)
    expect(await api.ver(ADMIN, { busca: 'zzzxyz', limite: 100 })).toMatchObject({ itens: [], total: 0 })
  })
  it('o saldo e o resumo do mês não mudam com a busca (ela só filtra o extrato)', async () => {
    await lanc({ tipo: 'DESPESA', valor: 80, obs: 'Conta de luz' })
    const todo = await api.ver(ADMIN, { limite: 100 })
    const achou = await api.ver(ADMIN, { busca: 'luz', limite: 100 })
    expect(achou).toMatchObject({ saldo: todo.saldo, entrouMes: todo.entrouMes, saiuMes: todo.saiuMes })
    expect(achou.total).toBeLessThan(todo.total)
  })
  it('acha pelo cliente de um recebimento/venda', async () => {
    await venda(3)
    const todo = await api.ver(ADMIN, { limite: 100 })
    const cliente = todo.itens.find((m) => m.categoria === 'ENTRADA_VENDA')!.titulo.replace('Entrada · ', '').split(' ')[0]
    const r = await api.ver(ADMIN, { busca: cliente, limite: 100 })
    expect(r.itens.some((m) => m.categoria === 'ENTRADA_VENDA')).toBe(true)
  })
})
