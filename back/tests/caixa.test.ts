import type { FastifyInstance } from 'fastify'
import type { Knex } from 'knex'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { createAuditoriaRepository } from '../src/modules/auditoria/models/repository.js'
import { createSessoesRepository, createUsuariosRepository } from '../src/modules/auth/models/repository.js'
import { createAuthService } from '../src/modules/auth/services/auth.service.js'
import { hashSenha } from '../src/modules/auth/services/password.js'
import { createTokensService } from '../src/modules/auth/services/tokens.js'
import { createCaixaRepository } from '../src/modules/caixa/models/repository.js'
import { createCaixaService } from '../src/modules/caixa/services/caixa.service.js'
import { createConfigRepository } from '../src/modules/config/models/repository.js'
import { createConfigService } from '../src/modules/config/services/config.service.js'
import { createEstoqueRepository } from '../src/modules/estoque/models/repository.js'
import { createEstoqueService } from '../src/modules/estoque/services/estoque.service.js'
import { createIndicadoresRepository } from '../src/modules/indicadores/models/repository.js'
import { createIndicadoresService } from '../src/modules/indicadores/services/indicadores.service.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()
const SENHA = 'senha-forte-123'
const HOJE = '2026-10-15'

type Mov = { chave: string; data: string; valor: number; entrada: boolean; categoria: string; titulo: string; sub: string; manualId: number | null }
type Caixa = { saldo: number; marcoZero: string | null; entrouMes: number; saiuMes: number; hoje: string; mes: string; itens: Mov[]; total: number; pagina: number; limite: number }

describe.skipIf(!db)('caixa da loja (Postgres de verdade)', () => {
  let app: FastifyInstance
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}
  const req = (metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, papel?: string, payload?: object) => app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  const caixa = async (q = '', papel = 'admin') => (await req('GET', `/api/caixa${q}`, papel)).json() as Caixa
  const cat = (c: Caixa, categoria: string) => c.itens.filter((i) => i.categoria === categoria)

  async function recibo(clienteId: number, valor: number, data: string, o: { indicadorId?: number | null; desfeito?: boolean; entradaVendaId?: number; parcelaVenda?: number; parcelaEmp?: number } = {}) {
    const [tr] = await db!('transacoes_recebimento').insert({
      numero_recibo: Math.floor(Math.random() * 1e9), cliente_id: clienteId, valor_total: valor, forma_pagamento: 'PIX', data_recebimento: data, desfeita_em: o.desfeito ? new Date() : null,
      cobrado_por_indicador_id: o.indicadorId ?? null, resumo: JSON.stringify({ referencia: 'parcela 1/4' }),
    }).returning('id')
    if (o.entradaVendaId) await db!('recebimentos').insert({ transacao_id: tr.id, tipo: 'ENTRADA', venda_id: o.entradaVendaId, valor })
    else if (o.parcelaVenda) await db!('recebimentos').insert({ transacao_id: tr.id, tipo: 'PARCELA', venda_parcela_id: o.parcelaVenda, valor })
    else if (o.parcelaEmp) await db!('recebimentos').insert({ transacao_id: tr.id, tipo: 'PARCELA', emprestimo_parcela_id: o.parcelaEmp, valor })
  }
  const bem = async (o: Record<string, unknown> = {}) => (await db!('bens').insert({ modelo: 'IPHONE 13', gb: 128, cor: 'PRETO', preco_venda: 3000, valor_compra: 2000, custos_extras: 0, data_compra: '2026-10-01', ...o }).returning('id'))[0].id as number
  const manual = (tipo: string, valor: number, data: string, obs: string | null = null) => db!('movimentacoes_caixa').insert({ tipo, valor, data, obs })

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    const hash = await hashSenha(SENHA)
    id.ind = (await k('indicadores').insert({ nome: 'Roberto', pct: 0.5 }).returning('id'))[0].id
    for (const [c, perfil, extra] of [['admin', 'ADMIN', {}], ['vendedor', 'VENDEDOR', {}], ['cobrador', 'COBRADOR', {}], ['indicador', 'INDICADOR', { indicador_id: id.ind }]] as const) {
      id[c] = (await k('users').insert({ nome: `${c} Silva`, email: `${c}@t.com`, senha_hash: hash, perfil, ...extra }).returning('id'))[0].id
    }
    id.cli = (await k('clientes').insert({ nome: 'ANA SOUZA', fone: '11988124410' }).returning('id'))[0].id
    const tokens = createTokensService('x'.repeat(40), '15m')
    const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
    const audit = createAuditoriaRepository(k)
    const indicadores = createIndicadoresService(createIndicadoresRepository(k), audit)
    app = await buildApp({
      env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, clientes: {} as never, usuarios: {} as never, indicadores,
      estoque: createEstoqueService(createEstoqueRepository(k), audit), config: createConfigService(createConfigRepository(k)), vendas: {} as never, recebimentos: {} as never,
      aprovacoes: {} as never, fechamentos: {} as never, equipe: {} as never, caixa: createCaixaService({ repo: createCaixaRepository(k), auditoria: audit, hoje: () => HOJE }),
      limites: { vendasPorMinuto: 100_000, recebimentosPorMinuto: 100_000 },
    })
    for (const papel of ['admin', 'vendedor', 'cobrador', 'indicador']) t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  })
  /** Cada teste começa com o banco do caixa vazio (clientes e usuários ficam). */
  beforeEach(async () => {
    const k = db!
    for (const tab of ['recebimentos', 'transacoes_recebimento', 'repasses_indicador', 'movimentacoes_caixa', 'auditoria', 'emprestimo_parcelas', 'emprestimos', 'venda_parcelas', 'vendas', 'bens']) await k(tab).del()
  })
  afterAll(async () => { await app?.close(); await db?.destroy() })

  describe('o que entra e o que sai', () => {
    it('caixa vazio: saldo zero, sem marco zero', async () => {
      expect(await caixa()).toMatchObject({ saldo: 0, marcoZero: null, entrouMes: 0, saiuMes: 0, total: 0, itens: [], hoje: HOJE, mes: '2026-10' })
    })

    it('recebimento cobrado pela loja ENTRA, com o cliente, o aparelho e a parcela', async () => {
      const b = await bem({ modelo: 'IPHONE 15', valor_compra: 0 }) // custo zero: a compra do aparelho não entra nesta conta
      const [v] = await db!('vendas').insert({ bem_id: b, cliente_id: id.cli, data_venda: '2026-09-01', valor_investido: 2000, valor_total: 3000, preco_acordado: 3000 }).returning('id')
      const [p] = await db!('venda_parcelas').insert({ venda_id: v.id, numero: 1, vencimento: '2026-10-10', valor: 500 }).returning('id')
      await recibo(id.cli, 500, '2026-10-10', { parcelaVenda: p.id })
      const c = await caixa()
      expect(c.itens).toHaveLength(1)
      expect(c.itens[0]).toMatchObject({ categoria: 'RECEBIMENTO', entrada: true, valor: 500, titulo: 'ANA SOUZA', sub: 'IPHONE 15 · parcela 1/4 · Pix', data: '2026-10-10', manualId: null })
      expect(c.saldo).toBe(500)
    })

    it('a entrada da venda entra como "Entrada · cliente"', async () => {
      const b = await bem({ valor_compra: 0 })
      const [v] = await db!('vendas').insert({ bem_id: b, cliente_id: id.cli, data_venda: '2026-10-02', valor_investido: 2000, valor_total: 3000, preco_acordado: 3000 }).returning('id')
      await recibo(id.cli, 800, '2026-10-02', { entradaVendaId: v.id })
      const [m] = (await caixa()).itens
      expect(m).toMatchObject({ categoria: 'ENTRADA_VENDA', titulo: 'Entrada · ANA SOUZA', sub: 'IPHONE 13 · Pix', valor: 800, entrada: true })
    })

    it('recebimento de empréstimo mostra o tipo do empréstimo', async () => {
      const [e] = await db!('emprestimos').insert({ cliente_id: id.cli, data_emprestimo: '2026-08-01', capital: 1000, modalidade: 'JUROS', taxa: 10, periodicidade: 'QUINZENAL' }).returning('id')
      const [p] = await db!('emprestimo_parcelas').insert({ emprestimo_id: e.id, numero: 1, vencimento: '2026-10-05', valor: 100 }).returning('id')
      await recibo(id.cli, 100, '2026-10-05', { parcelaEmp: p.id })
      expect(cat(await caixa(), 'RECEBIMENTO')[0].sub).toBe('Empréstimo só juros quinzenal · parcela 1/4 · Pix')
    })

    it('o que o INDICADOR cobrou direto do cliente NÃO entra (só quando ele repassa)', async () => {
      await recibo(id.cli, 700, '2026-10-05', { indicadorId: id.ind })
      expect((await caixa()).itens).toEqual([])
    })

    it('recibo desfeito NÃO entra', async () => {
      await recibo(id.cli, 700, '2026-10-05', { desfeito: true })
      expect((await caixa()).total).toBe(0)
    })

    it('a transferência do indicador ENTRA, com o nome dele', async () => {
      await db!('movimentacoes_caixa').insert({ tipo: 'TRANSFERENCIA_INDICADOR', valor: 950, data: '2026-10-03', indicador_id: id.ind })
      expect((await caixa()).itens[0]).toMatchObject({ categoria: 'TRANSFERENCIA', entrada: true, valor: 950, titulo: 'Repasse do indicador · Roberto', manualId: null })
    })

    it('repasse pago ao indicador SAI', async () => {
      await db!('repasses_indicador').insert({ indicador_id: id.ind, valor: 300, data_repasse: '2026-10-04', forma_pagamento: 'PIX' })
      expect((await caixa()).itens[0]).toMatchObject({ categoria: 'REPASSE', entrada: false, valor: 300, titulo: 'Repasse · Roberto', sub: 'parte do lucro' })
    })

    it('transferência e repasse com data no FUTURO ainda não contam', async () => {
      await db!('movimentacoes_caixa').insert({ tipo: 'TRANSFERENCIA_INDICADOR', valor: 950, data: '2026-10-16', indicador_id: id.ind })
      await db!('repasses_indicador').insert({ indicador_id: id.ind, valor: 300, data_repasse: '2026-10-20', forma_pagamento: 'PIX' })
      expect(await caixa()).toMatchObject({ saldo: 0, total: 0 })
    })

    it('empréstimo liberado SAI na data dele; cancelado e com início no futuro NÃO contam', async () => {
      await db!('emprestimos').insert([
        { cliente_id: id.cli, data_emprestimo: '2026-10-01', capital: 5000, modalidade: 'PARCELADO', taxa: 30 },
        { cliente_id: id.cli, data_emprestimo: '2026-10-02', capital: 999, modalidade: 'PARCELADO', taxa: 30, status: 'CANCELADA' },
        { cliente_id: id.cli, data_emprestimo: '2026-11-28', capital: 888, modalidade: 'PARCELADO', taxa: 30 },
      ])
      const c = await caixa()
      expect(cat(c, 'EMPRESTIMO')).toHaveLength(1)
      expect(cat(c, 'EMPRESTIMO')[0]).toMatchObject({ entrada: false, valor: 5000, titulo: 'Empréstimo liberado · ANA SOUZA', sub: 'Empréstimo parcelado' })
      expect(c.saldo).toBe(-5000)
    })

    it('compra de aparelho SAI (custo + extras); encomendado, vindo de troca, custo zero e data futura NÃO contam', async () => {
      await bem({ modelo: 'IPHONE 14', valor_compra: 3000, custos_extras: 150, data_compra: '2026-10-02', estado: 'DISPONIVEL', cor: 'AZUL' })
      await bem({ modelo: 'ENCOMENDA', valor_compra: 1111, estado: 'ENCOMENDADO' })
      await bem({ modelo: 'TROCA', valor_compra: 2222, origem: 'TROCA' })
      await bem({ modelo: 'ZERO', valor_compra: 0 })
      await bem({ modelo: 'FUTURO', valor_compra: 4444, data_compra: '2026-12-01' })
      const c = await caixa()
      expect(cat(c, 'COMPRA')).toHaveLength(1)
      expect(cat(c, 'COMPRA')[0]).toMatchObject({ entrada: false, valor: 3150, titulo: 'Compra · IPHONE 14 128 GB', sub: 'AZUL', data: '2026-10-02' })
    })

    it('aparelho sem capacidade e sem cor definida não deixa "0 GB" nem "A DEFINIR" no extrato', async () => {
      await bem({ modelo: 'IPHONE 16 LACRADO', gb: 0, cor: 'A DEFINIR', valor_compra: 4000 })
      expect(cat(await caixa(), 'COMPRA')[0]).toMatchObject({ titulo: 'Compra · IPHONE 16 LACRADO', sub: '' })
    })
  })

  describe('marco zero: só conta a partir do primeiro aporte ou retirada', () => {
    it('sem lançamento manual, conta tudo', async () => {
      await recibo(id.cli, 100, '2026-01-05'); await recibo(id.cli, 200, '2026-10-05')
      expect(await caixa()).toMatchObject({ saldo: 300, marcoZero: null, total: 2 })
    })
    it('o que veio ANTES do primeiro aporte é ignorado, no saldo e no extrato', async () => {
      await recibo(id.cli, 100, '2026-09-17'); await recibo(id.cli, 200, '2026-09-18'); await recibo(id.cli, 400, '2026-10-05')
      await manual('APORTE', 7500, '2026-09-18')
      const c = await caixa()
      expect(c.marcoZero).toBe('2026-09-18'); expect(c.saldo).toBe(7500 + 200 + 400); expect(c.itens.map((i) => i.valor).sort((a, b) => a - b)).toEqual([200, 400, 7500])
    })
    it('o lançamento mais antigo define o marco, aporte ou retirada', async () => {
      await manual('APORTE', 1000, '2026-09-20'); await manual('RETIRADA', 100, '2026-09-10')
      expect((await caixa()).marcoZero).toBe('2026-09-10')
    })
    it('despesa não define marco zero', async () => {
      await manual('DESPESA', 50, '2026-08-01', 'aluguel'); await manual('APORTE', 1000, '2026-09-20')
      const c = await caixa()
      expect(c.marcoZero).toBe('2026-09-20'); expect(c.saldo).toBe(1000) // a despesa de agosto é de antes do marco
    })
  })

  describe('o saldo e o mês', () => {
    it('saldo = entradas − saídas; entrou e saiu mostram só o mês de hoje', async () => {
      await manual('APORTE', 10000, '2026-09-01')
      await recibo(id.cli, 1000, '2026-09-20')                                                                         // setembro: entra
      await recibo(id.cli, 300, '2026-10-02')                                                                          // outubro: entra
      await db!('repasses_indicador').insert({ indicador_id: id.ind, valor: 200, data_repasse: '2026-10-03', forma_pagamento: 'PIX' }) // outubro: sai
      await manual('RETIRADA', 150, '2026-10-04'); await manual('DESPESA', 50, '2026-10-05', 'internet')               // outubro: saem
      await db!('repasses_indicador').insert({ indicador_id: id.ind, valor: 77, data_repasse: '2026-09-25', forma_pagamento: 'PIX' }) // setembro: sai
      const c = await caixa()
      expect(c.saldo).toBe(10000 + 1000 + 300 - 200 - 150 - 50 - 77)
      expect(c.entrouMes).toBe(300); expect(c.saiuMes).toBe(200 + 150 + 50)
    })
    it('o último dia do mês e o dia 1º entram no mês; o dia 30/09 e o 01/11 não', async () => {
      await manual('APORTE', 1, '2026-09-01')
      await recibo(id.cli, 10, '2026-09-30'); await recibo(id.cli, 20, '2026-10-01'); await recibo(id.cli, 40, '2026-10-15')
      expect((await caixa()).entrouMes).toBe(20 + 40)
    })
    it('centavos não acumulam erro de ponto flutuante', async () => {
      await manual('APORTE', 0.1, '2026-10-01'); await manual('APORTE', 0.2, '2026-10-02')
      expect((await caixa()).saldo).toBe(0.3)
    })
    it('o saldo pode ficar negativo (não bloqueia)', async () => {
      await manual('RETIRADA', 500, '2026-10-01')
      expect((await caixa()).saldo).toBe(-500)
    })
  })

  describe('extrato', () => {
    it('vem do mais novo para o mais antigo e pagina com o total certo', async () => {
      await manual('APORTE', 1, '2026-10-01')
      for (let d = 2; d <= 7; d++) await recibo(id.cli, d, `2026-10-0${d}`)
      const p1 = await caixa('?limite=3&pagina=1'), p2 = await caixa('?limite=3&pagina=2')
      expect(p1.total).toBe(7); expect(p1.itens.map((i) => i.data)).toEqual(['2026-10-07', '2026-10-06', '2026-10-05'])
      expect(p2.itens.map((i) => i.data)).toEqual(['2026-10-04', '2026-10-03', '2026-10-02']); expect(p1.saldo).toBe(p2.saldo)
      expect((await caixa('?limite=3&pagina=3')).itens).toHaveLength(1)
    })
    it('limite é limitado a 100 e valores estranhos voltam ao padrão', async () => {
      expect((await caixa('?limite=99999')).limite).toBe(100); expect((await caixa('?limite=abc&pagina=-4')).limite).toBe(25); expect((await caixa('?pagina=0')).pagina).toBe(1)
    })
  })

  describe('quem pode', () => {
    it('só o administrador: cobrador, vendedor e indicador levam 403; sem login, 401', async () => {
      for (const papel of ['cobrador', 'vendedor', 'indicador']) {
        expect((await req('GET', '/api/caixa', papel)).statusCode, papel).toBe(403)
        expect((await req('POST', '/api/caixa/movimentos', papel, { tipo: 'APORTE', valor: 1 })).statusCode, papel).toBe(403)
      }
      expect((await req('GET', '/api/caixa')).statusCode).toBe(401)
      expect((await req('POST', '/api/caixa/movimentos', undefined, { tipo: 'APORTE', valor: 1 })).statusCode).toBe(401)
    })
    it('o cobrador não consegue editar nem excluir um lançamento', async () => {
      const [m] = await manual('APORTE', 100, '2026-10-01').returning('id')
      expect((await req('PATCH', `/api/caixa/movimentos/${m.id}`, 'cobrador', { valor: 1 })).statusCode).toBe(403)
      expect((await req('DELETE', `/api/caixa/movimentos/${m.id}`, 'cobrador')).statusCode).toBe(403)
      expect(await db!('movimentacoes_caixa').where({ id: m.id }).first()).toMatchObject({ valor: '100.00' })
    })
  })

  describe('lançar, editar e excluir (aporte, retirada, despesa)', () => {
    it('lança com data de hoje por padrão, mexe no saldo e fica na auditoria', async () => {
      const r = await req('POST', '/api/caixa/movimentos', 'admin', { tipo: 'APORTE', valor: 7500.5, obs: '  saldo de abertura ' })
      expect(r.statusCode).toBe(201)
      expect(r.json()).toMatchObject({ tipo: 'APORTE', valor: 7500.5, data: HOJE, obs: 'saldo de abertura' })
      expect((await caixa()).saldo).toBe(7500.5)
      expect(await db!('movimentacoes_caixa').first()).toMatchObject({ usuario_id: id.admin })
      expect(await db!('auditoria').where({ acao: 'CAIXA_LANCADO' }).count('* as n').first()).toMatchObject({ n: '1' })
    })
    it('o lançamento aparece no extrato com o id para editar; o título é a observação', async () => {
      await req('POST', '/api/caixa/movimentos', 'admin', { tipo: 'DESPESA', valor: 90, obs: 'internet do escritório' })
      const m = (await caixa()).itens[0]
      expect(m).toMatchObject({ categoria: 'DESPESA', entrada: false, titulo: 'internet do escritório', sub: 'Despesa' }); expect(m.manualId).toBeGreaterThan(0)
      await req('POST', '/api/caixa/movimentos', 'admin', { tipo: 'RETIRADA', valor: 10 })
      expect(cat(await caixa(), 'RETIRADA')[0]).toMatchObject({ titulo: 'Retirada', sub: 'Retirada' })
    })
    it('edita só o que veio (valor, data, obs, tipo) e guarda antes e depois', async () => {
      const { id: mid } = (await req('POST', '/api/caixa/movimentos', 'admin', { tipo: 'APORTE', valor: 100, data: '2026-10-01', obs: 'a' })).json()
      const r = await req('PATCH', `/api/caixa/movimentos/${mid}`, 'admin', { valor: 250 })
      expect(r.json()).toMatchObject({ tipo: 'APORTE', valor: 250, data: '2026-10-01', obs: 'a' })
      expect((await req('PATCH', `/api/caixa/movimentos/${mid}`, 'admin', { tipo: 'RETIRADA', obs: 'virou saída' })).json()).toMatchObject({ tipo: 'RETIRADA', valor: 250, obs: 'virou saída' })
      expect((await caixa()).saldo).toBe(-250)
      const aud = await db!('auditoria').where({ acao: 'CAIXA_EDITADO' }).orderBy('id')
      expect(aud).toHaveLength(2); expect(aud[0].antes).toMatchObject({ valor: 100 }); expect(aud[0].depois).toMatchObject({ valor: 250 })
    })
    it('apagar a observação de um aporte é permitido; de uma despesa, não', async () => {
      const a = (await req('POST', '/api/caixa/movimentos', 'admin', { tipo: 'APORTE', valor: 1, obs: 'x' })).json().id
      expect((await req('PATCH', `/api/caixa/movimentos/${a}`, 'admin', { obs: '' })).json().obs).toBeNull()
      const d = (await req('POST', '/api/caixa/movimentos', 'admin', { tipo: 'DESPESA', valor: 1, obs: 'x' })).json().id
      expect((await req('PATCH', `/api/caixa/movimentos/${d}`, 'admin', { obs: '  ' })).statusCode).toBe(400)
    })
    it('exclui (204), o saldo volta e a auditoria guarda o que foi apagado', async () => {
      const { id: mid } = (await req('POST', '/api/caixa/movimentos', 'admin', { tipo: 'APORTE', valor: 300 })).json()
      expect((await req('DELETE', `/api/caixa/movimentos/${mid}`, 'admin')).statusCode).toBe(204)
      expect((await caixa()).saldo).toBe(0)
      expect((await db!('auditoria').where({ acao: 'CAIXA_EXCLUIDO' }).first()).antes).toMatchObject({ valor: 300, tipo: 'APORTE' })
      expect((await req('DELETE', `/api/caixa/movimentos/${mid}`, 'admin')).statusCode).toBe(404)
    })
    it('transferência do indicador e id que não existe NÃO se editam nem se excluem (404)', async () => {
      const [tr] = await db!('movimentacoes_caixa').insert({ tipo: 'TRANSFERENCIA_INDICADOR', valor: 5, data: '2026-10-01', indicador_id: id.ind }).returning('id')
      expect((await req('PATCH', `/api/caixa/movimentos/${tr.id}`, 'admin', { valor: 1 })).statusCode).toBe(404)
      expect((await req('DELETE', `/api/caixa/movimentos/${tr.id}`, 'admin')).statusCode).toBe(404)
      expect((await req('PATCH', '/api/caixa/movimentos/999999', 'admin', { valor: 1 })).statusCode).toBe(404)
      expect(await db!('movimentacoes_caixa').where({ id: tr.id }).first()).toMatchObject({ valor: '5.00' })
    })
    it('id inválido é 400', async () => {
      for (const i of ['abc', '0', '-3', '1.5']) expect((await req('DELETE', `/api/caixa/movimentos/${i}`, 'admin')).statusCode, i).toBe(400)
    })
    it.each([
      ['tipo ausente', { valor: 1 }], ['tipo inválido', { tipo: 'DOACAO', valor: 1 }], ['tipo de transferência não vale', { tipo: 'TRANSFERENCIA_INDICADOR', valor: 1 }],
      ['valor ausente', { tipo: 'APORTE' }], ['valor zero', { tipo: 'APORTE', valor: 0 }], ['valor negativo', { tipo: 'APORTE', valor: -5 }], ['valor em texto', { tipo: 'APORTE', valor: '10' }],
      ['valor enorme', { tipo: 'APORTE', valor: 2e9 }], ['valor infinito', { tipo: 'APORTE', valor: null }], ['data mal escrita', { tipo: 'APORTE', valor: 1, data: '10/10/2026' }],
      ['data impossível', { tipo: 'APORTE', valor: 1, data: '2026-02-30' }], ['data no futuro', { tipo: 'APORTE', valor: 1, data: '2026-10-16' }], ['data antiga demais', { tipo: 'APORTE', valor: 1, data: '1999-12-31' }],
      ['obs longa', { tipo: 'APORTE', valor: 1, obs: 'x'.repeat(201) }], ['obs que não é texto', { tipo: 'APORTE', valor: 1, obs: 7 }], ['despesa sem descrição', { tipo: 'DESPESA', valor: 1 }],
    ])('lançamento inválido (%s) é 400 e não grava nada', async (_n, corpo) => {
      expect((await req('POST', '/api/caixa/movimentos', 'admin', corpo as object)).statusCode).toBe(400)
      expect(await db!('movimentacoes_caixa').count('* as n').first()).toMatchObject({ n: '0' })
    })
    it('hoje e o limite de 200 letras são aceitos', async () => {
      expect((await req('POST', '/api/caixa/movimentos', 'admin', { tipo: 'APORTE', valor: 1, data: HOJE, obs: 'x'.repeat(200) })).statusCode).toBe(201)
    })
    it('edição inválida não altera o lançamento', async () => {
      const { id: mid } = (await req('POST', '/api/caixa/movimentos', 'admin', { tipo: 'APORTE', valor: 100 })).json()
      for (const corpo of [{ valor: -1 }, { data: '2027-01-01' }, { tipo: 'X' }]) expect((await req('PATCH', `/api/caixa/movimentos/${mid}`, 'admin', corpo)).statusCode).toBe(400)
      expect(await db!('movimentacoes_caixa').where({ id: mid }).first()).toMatchObject({ valor: '100.00' })
    })
  })
})
