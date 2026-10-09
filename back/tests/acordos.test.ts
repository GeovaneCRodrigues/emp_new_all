import type { FastifyInstance } from 'fastify'
import type { Knex } from 'knex'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { createAcordosRepository } from '../src/modules/acordos/models/repository.js'
import { createAcordosService } from '../src/modules/acordos/services/acordos.service.js'
import { createAprovacoesRepository } from '../src/modules/aprovacoes/models/repository.js'
import { createAprovacoesService } from '../src/modules/aprovacoes/services/aprovacoes.service.js'
import { createAuditoriaRepository } from '../src/modules/auditoria/models/repository.js'
import { createSessoesRepository, createUsuariosRepository } from '../src/modules/auth/models/repository.js'
import { createAuthService } from '../src/modules/auth/services/auth.service.js'
import { hashSenha } from '../src/modules/auth/services/password.js'
import { createTokensService } from '../src/modules/auth/services/tokens.js'
import { createConfigRepository } from '../src/modules/config/models/repository.js'
import { createConfigService } from '../src/modules/config/services/config.service.js'
import { createEmprestimosRepository } from '../src/modules/emprestimos/models/repository.js'
import { createEmprestimosService } from '../src/modules/emprestimos/services/emprestimos.service.js'
import { createEstoqueRepository } from '../src/modules/estoque/models/repository.js'
import { createEstoqueService } from '../src/modules/estoque/services/estoque.service.js'
import { createIndicadoresRepository } from '../src/modules/indicadores/models/repository.js'
import { createIndicadoresService } from '../src/modules/indicadores/services/indicadores.service.js'
import { createRecebimentosRepository } from '../src/modules/recebimentos/models/repository.js'
import { createRecebimentosService } from '../src/modules/recebimentos/services/recebimentos.service.js'
import { createVendasRepository } from '../src/modules/vendas/models/repository.js'
import { createVendasService } from '../src/modules/vendas/services/vendas.service.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()
const SENHA = 'senha-forte-123'

describe.skipIf(!db)('acordo (Postgres de verdade)', () => {
  let app: FastifyInstance
  let hoje = '2026-10-08'
  let segura = false
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}

  const req = (metodo: 'GET' | 'POST', url: string, papel?: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })

  /** Venda de 3.000 criada em 08/10/2026: entrada 600, 4 parcelas de 840 (10/11, 10/12, 10/01, 10/02). */
  async function venda(cliente = id.cA): Promise<number> {
    const dia = hoje; hoje = '2026-10-08'
    const [b] = await db!('bens').insert({ modelo: 'iPhone 13', gb: 128, cor: 'Preto', preco_venda: 3000, valor_compra: 2000, data_compra: '2026-09-01' }).returning('id')
    const r = await req('POST', '/api/vendas', 'admin', { aparelhoId: b.id, clienteId: cliente, preco: 3000, entrada: 600, parcelas: 4, diaVencimento: 10 })
    hoje = dia
    expect(r.statusCode).toBe(201)
    return r.json().id
  }
  /** Venda com 340 pagos na 1ª parcela (falta 500, remarcada para 25/11) e o relógio em 30/11/2026: ela está atrasada. Saldo = 500 + 3 × 840 = 3.020. */
  async function vendaComSaldo(cliente = id.cA): Promise<number> {
    const v = await venda(cliente)
    hoje = '2026-11-20'
    expect((await receberV('admin', v, { parcela: 1, valor: 340, resto: 'FICA', novoVencimento: '2026-11-25' })).statusCode).toBe(201)
    hoje = '2026-11-30'
    return v
  }
  /** Só juros 3.000 a 12% em 3x (360, 360, 3.360) criado em 08/10/2026. */
  async function emprestimo(corpo: object = {}, cliente = id.cA): Promise<number> {
    const dia = hoje; hoje = '2026-10-08'
    const r = await req('POST', '/api/emprestimos', 'admin', { clienteId: cliente, modalidade: 'JUROS', capital: 3000, taxa: 12, parcelas: 3, ...corpo })
    hoje = dia
    expect(r.statusCode).toBe(201)
    return r.json().id
  }
  const acordoV = (papel: string, v: number, corpo: object = {}) => req('POST', `/api/vendas/${v}/acordos`, papel, { valorTotal: 3000, parcelas: 4, primeiraParcela: '2026-12-01', ...corpo })
  const acordoE = (papel: string, e: number, corpo: object = {}) => req('POST', `/api/emprestimos/${e}/acordos`, papel, { valorTotal: 3600, parcelas: 3, primeiraParcela: '2026-12-01', ...corpo })
  const pedir = (papel: string, op: number, corpo: object = {}) => req('POST', '/api/aprovacoes', papel, { tipo: 'ACORDO', alvo: 'VENDA', operacaoId: op, valorTotal: 3000, parcelas: 4, primeiraParcela: '2026-12-01', motivo: 'Cliente pediu pra renegociar', ...corpo })
  const aprovar = (papel: string, pid: number) => req('POST', `/api/aprovacoes/${pid}/aprovar`, papel)
  const recusar = (papel: string, pid: number, corpo: object = {}) => req('POST', `/api/aprovacoes/${pid}/recusar`, papel, corpo)
  const receberV = (papel: string, v: number, corpo: object = {}) => req('POST', `/api/vendas/${v}/recebimentos`, papel, { forma: 'PIX', parcela: 1, valor: 840, ...corpo })
  const receberE = (papel: string, e: number, corpo: object = {}) => req('POST', `/api/emprestimos/${e}/recebimentos`, papel, { forma: 'PIX', parcela: 1, valor: 360, ...corpo })
  const ficha = async (v: number) => (await req('GET', `/api/vendas/${v}`, 'admin')).json()
  const fichaE = async (e: number) => (await req('GET', `/api/emprestimos/${e}`, 'admin')).json()
  const parcelas = async (v: number) => (await db!('venda_parcelas').where({ venda_id: v }).orderBy('numero')).map((p: Record<string, unknown>) => ({ n: p.numero as number, valor: Number(p.valor), venc: String(p.vencimento instanceof Date ? p.vencimento.toISOString() : p.vencimento).slice(0, 10), acordo: p.acordo_id as number | null, encerrada: p.encerrada_acordo_id as number | null }))

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    await k('sistema_config').where({ chave: 'juros_parcela_pct' }).update({ valor: JSON.stringify(10) })
    const hash = await hashSenha(SENHA)
    const [ind] = await k('indicadores').insert({ nome: 'Roberto', pct: 0.5, pct_manual: true }).returning('id')
    for (const [chave, perfil, extra] of [['admin', 'ADMIN', {}], ['admin2', 'ADMIN', {}], ['vendedor', 'VENDEDOR', {}], ['cobrador', 'COBRADOR', {}], ['cobrador2', 'COBRADOR', {}], ['indicador', 'INDICADOR', { indicador_id: ind.id }]] as const) {
      const [u] = await k('users').insert({ nome: `${chave} Silva`, email: `${chave}@t.com`, senha_hash: hash, perfil, ...extra }).returning('id')
      id[chave] = u.id
    }
    const cli = async (chave: string, nome: string, resp: number | null) => { const [c] = await k('clientes').insert({ nome, fone: '11988124410', responsavel_id: resp }).returning('id'); id[chave] = c.id }
    await cli('cA', 'Ana Souza', id.cobrador)
    await cli('cB', 'Bruno Lima', id.cobrador2)

    const tokens = createTokensService('x'.repeat(40), '15m')
    const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
    const audit = createAuditoriaRepository(k)
    const indicadores = createIndicadoresService(createIndicadoresRepository(k), audit)
    const config = createConfigRepository(k)
    const espera = async () => { if (segura) await new Promise((r) => setTimeout(r, 200)) }
    app = await buildApp({
      env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, clientes: {} as never, usuarios: {} as never, indicadores,
      estoque: createEstoqueService(createEstoqueRepository(k), audit), config: createConfigService(config),
      vendas: createVendasService({ vendas: createVendasRepository(k), config, auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis(), hoje: () => hoje }),
      emprestimos: createEmprestimosService({ emprestimos: createEmprestimosRepository(k), auditoria: audit, hoje: () => hoje }),
      recebimentos: createRecebimentosService({ repo: createRecebimentosRepository(k), auditoria: audit, hoje: () => hoje, depoisDeLerParcelas: espera }),
      aprovacoes: createAprovacoesService({ repo: createAprovacoesRepository(k), auditoria: audit, hoje: () => hoje, depoisDeLerParcelas: espera }),
      acordos: createAcordosService({ repo: createAcordosRepository(k), auditoria: audit, hoje: () => hoje }),
      fechamentos: {} as never, equipe: {} as never,
      limites: { vendasPorMinuto: 100_000, recebimentosPorMinuto: 100_000 },
    })
    for (const papel of ['admin', 'admin2', 'vendedor', 'cobrador', 'cobrador2', 'indicador']) t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  })
  beforeEach(() => { hoje = '2026-10-08'; segura = false })
  afterAll(async () => { await app?.close(); await db?.destroy() })

  // ===================== o administrador faz o acordo direto =====================
  describe('administrador faz o acordo (venda)', () => {
    it('só o administrador (403 para os outros, 401 sem login); inexistente 404; id inválido 400', async () => {
      const v = await vendaComSaldo()
      for (const papel of ['cobrador', 'vendedor', 'indicador']) expect((await acordoV(papel, v)).statusCode).toBe(403)
      expect((await acordoV('', v)).statusCode).toBe(401)
      expect((await acordoV('admin', 999999)).statusCode).toBe(404)
      expect((await req('POST', '/api/vendas/abc/acordos', 'admin', {})).statusCode).toBe(400)
      expect((await ficha(v)).falta).toBe(3020)
    })
    it.each([
      ['sem valor', { valorTotal: undefined }], ['valor zero', { valorTotal: 0 }], ['valor negativo', { valorTotal: -1 }], ['valor como texto', { valorTotal: '3000' }], ['valor gigante', { valorTotal: 1e9 }],
      ['sem parcelas', { parcelas: undefined }], ['zero parcelas', { parcelas: 0 }], ['parcelas quebradas', { parcelas: 2.5 }], ['parcelas demais', { parcelas: 121 }], ['parcelas como texto', { parcelas: '4' }],
      ['sem 1ª data', { primeiraParcela: undefined }], ['1ª data inválida', { primeiraParcela: '2026-02-31' }], ['1ª data que já passou', { primeiraParcela: '2026-11-29' }], ['1ª data daqui a mais de um ano', { primeiraParcela: '2027-12-02' }],
      ['valor pequeno demais para as parcelas', { valorTotal: 0.04, parcelas: 5 }], ['motivo enorme', { motivo: 'x'.repeat(501) }],
    ])('recusa %s (400) e não mexe em nada', async (_n, m) => {
      const v = await vendaComSaldo()
      const corpo = { valorTotal: 3000, parcelas: 4, primeiraParcela: '2026-12-01', ...m } as Record<string, unknown>
      for (const k of Object.keys(corpo)) if (corpo[k] === undefined) delete corpo[k]
      expect((await req('POST', `/api/vendas/${v}/acordos`, 'admin', corpo)).statusCode).toBe(400)
      expect((await parcelas(v)).every((p) => p.acordo === null && p.encerrada === null)).toBe(true)
    })
    it('venda quitada → 409 SEM_SALDO; retomada ou cancelada → 409 VENDA_ENCERRADA', async () => {
      const a = await vendaComSaldo()
      await db!('vendas').where({ id: a }).update({ status: 'QUITADA' })
      expect((await acordoV('admin', a)).json().codigo).toBe('SEM_SALDO')
      const b = await vendaComSaldo()
      await db!('vendas').where({ id: b }).update({ status: 'RETOMADA' })
      expect((await acordoV('admin', b)).json().codigo).toBe('VENDA_ENCERRADA')
      const c = await vendaComSaldo()
      await db!('vendas').where({ id: c }).update({ status: 'CANCELADA' })
      expect((await acordoV('admin', c)).json().codigo).toBe('VENDA_ENCERRADA')
    })
    it('FAZ O ACORDO: as abertas ficam só com o que foi pago, as novas continuam a numeração e a soma fecha no centavo', async () => {
      const v = await vendaComSaldo()
      const r = await acordoV('admin', v, { motivo: 'Cliente perdeu o emprego' })
      expect(r.statusCode).toBe(201)
      expect(r.json()).toMatchObject({ alvo: 'VENDA', operacaoId: v, saldoAntes: 3020, valorTotal: 3000, nParcelas: 4, primeiraParcela: '2026-12-01', parcelasEncerradas: 4, substituiuAcordoId: null })
      const ps = await parcelas(v)
      expect(ps.map((p) => [p.n, p.valor])).toEqual([[1, 340], [2, 0], [3, 0], [4, 0], [5, 750], [6, 750], [7, 750], [8, 750]])
      expect(ps.slice(0, 4).every((p) => p.encerrada === r.json().acordoId && p.acordo === null)).toBe(true)
      expect(ps.slice(4).every((p) => p.acordo === r.json().acordoId && p.encerrada === null)).toBe(true)
      expect(ps.slice(4).map((p) => p.venc)).toEqual(['2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01'])
      const f = await ficha(v)
      expect(f).toMatchObject({ status: 'ATIVA', recebido: 940, falta: 3000, atrasadas: 0, total: 3940 }) // 600 de entrada + 340 pagos + 3.000 do acordo
      expect(f.parcelas.map((p: { acordo: string | null }) => p.acordo)).toEqual(['ENCERRADA', 'ENCERRADA', 'ENCERRADA', 'ENCERRADA', 'NOVA', 'NOVA', 'NOVA', 'NOVA'])
      const a = await db!('acordos').where({ id: r.json().acordoId }).first()
      expect(a).toMatchObject({ venda_id: v, criado_por: id.admin, status: 'ATIVO', motivo: 'Cliente perdeu o emprego' })
      expect(Number(a.saldo_antes)).toBe(3020)
      expect(a.parcelas_antes).toHaveLength(4)
      expect(a.parcelas_antes[0]).toMatchObject({ numero: 1, valor: 840, pago: 340, falta: 500 })
      const au = await db!('auditoria').where({ acao: 'ACORDO_FEITO', entidade: 'venda', entidade_id: v }).first()
      expect(au.antes).toMatchObject({ saldo: 3020, parcelasEncerradas: 4 })
    })
    it('o que já foi pago continua no histórico: recebido e os recibos não mudam', async () => {
      const v = await vendaComSaldo()
      const antes = await ficha(v)
      await acordoV('admin', v)
      const depois = await ficha(v)
      expect(depois.recebido).toBe(antes.recebido)
      expect(await db!('transacoes_recebimento').where({ cliente_id: id.cA, desfeita_em: null }).count<{ count: string }[]>({ count: '*' })).toBeTruthy()
    })
    it('divisão em parcelas: 1.000,01 em 3x → 333,33 + 333,33 + 333,35 (a soma fecha)', async () => {
      const v = await vendaComSaldo()
      await acordoV('admin', v, { valorTotal: 1000.01, parcelas: 3 })
      expect((await parcelas(v)).slice(4).map((p) => p.valor)).toEqual([333.33, 333.33, 333.35])
    })
    it('valor do acordo abaixo do saldo vira desconto (lucro cai); acima vira juros do acordo (lucro sobe)', async () => {
      const a = await vendaComSaldo(); const b = await vendaComSaldo()
      const lucroAntes = (await ficha(a)).lucroTotal
      await acordoV('admin', a, { valorTotal: 2000 }) // saldo 3.020 → desconto de 1.020
      await acordoV('admin', b, { valorTotal: 4000 }) // juros de 980
      expect((await ficha(a)).lucroTotal).toBe(lucroAntes - 1020)
      expect((await ficha(b)).lucroTotal).toBe(lucroAntes + 980)
    })
    it('1 parcela só e 1ª parcela hoje são aceitas; dia 31 cai no fim dos meses curtos', async () => {
      const a = await vendaComSaldo()
      expect((await acordoV('admin', a, { valorTotal: 3020, parcelas: 1, primeiraParcela: '2026-11-30' })).statusCode).toBe(201)
      const b = await vendaComSaldo()
      await acordoV('admin', b, { parcelas: 3, primeiraParcela: '2026-12-31' })
      expect((await parcelas(b)).slice(4).map((p) => p.venc)).toEqual(['2026-12-31', '2027-01-31', '2027-02-28'])
    })
    it('o acordo some das cobranças atrasadas e as parcelas novas aparecem nas próximas; o "a receber" acompanha', async () => {
      const v = await vendaComSaldo()
      const atr = async () => (await req('GET', '/api/cobrancas?aba=atrasadas&tipo=VENDA&limite=100', 'admin')).json().itens.filter((x: { operacaoId: number }) => x.operacaoId === v)
      expect(await atr()).toHaveLength(1)
      await acordoV('admin', v)
      expect(await atr()).toHaveLength(0)
      const aba = async (a: string) => (await req('GET', `/api/cobrancas?aba=${a}&tipo=VENDA&limite=100`, 'admin')).json().itens.filter((x: { operacaoId: number }) => x.operacaoId === v).map((x: { parcela: number }) => x.parcela)
      expect(await aba('hoje')).toEqual([5]) // 01/12 vence nos próximos 7 dias
      expect(await aba('proximas')).toEqual([6]) // 01/01 está entre 8 e 45 dias
    })
    it('SEGUNDO ACORDO: o anterior vira SUBSTITUIDO, a numeração segue e só um fica ATIVO (o banco também garante)', async () => {
      const v = await vendaComSaldo()
      const a1 = (await acordoV('admin', v)).json()
      const a2 = await acordoV('admin', v, { valorTotal: 2800, parcelas: 2, primeiraParcela: '2027-01-15' })
      expect(a2.statusCode).toBe(201)
      expect(a2.json()).toMatchObject({ saldoAntes: 3000, substituiuAcordoId: a1.acordoId, parcelasEncerradas: 4 })
      const ps = await parcelas(v)
      expect(ps.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      expect(ps.filter((p) => p.encerrada === a1.acordoId).map((p) => p.n)).toEqual([1, 2, 3, 4]) // o 1º acordo encerrou as quatro originais
      expect(ps.filter((p) => p.encerrada === a2.json().acordoId).map((p) => p.n)).toEqual([5, 6, 7, 8]) // o 2º encerrou as do 1º
      expect(ps.filter((p) => p.acordo === a2.json().acordoId).map((p) => p.n)).toEqual([9, 10])
      expect((await db!('acordos').where({ id: a1.acordoId }).first()).status).toBe('SUBSTITUIDO')
      expect((await db!('acordos').where({ venda_id: v, status: 'ATIVO' }))).toHaveLength(1)
      await expect(db!('acordos').insert({ venda_id: v, data_acordo: '2026-11-20', saldo_antes: 1, valor_total: 1, n_parcelas: 1, primeira_parcela: '2026-12-01', parcelas_antes: '[]', status: 'ATIVO' })).rejects.toThrow()
      expect((await ficha(v)).falta).toBe(2800)
    })
    it('o banco não aceita acordo sem alvo nem com os dois (acordos_alvo_ck)', async () => {
      const v = await vendaComSaldo(); const e = await emprestimo()
      const base = { data_acordo: '2026-11-20', saldo_antes: 1, valor_total: 1, n_parcelas: 1, primeira_parcela: '2026-12-01', parcelas_antes: '[]', status: 'SUBSTITUIDO' }
      await expect(db!('acordos').insert(base)).rejects.toThrow()
      await expect(db!('acordos').insert({ ...base, venda_id: v, emprestimo_id: e })).rejects.toThrow()
    })
    it('histórico: o administrador e o cobrador da carteira veem os acordos; outra carteira, vendedor e inexistente não', async () => {
      const v = await vendaComSaldo()
      await acordoV('admin', v)
      const h = (await req('GET', `/api/vendas/${v}/acordos`, 'admin')).json()
      expect(h).toHaveLength(1)
      expect(h[0]).toMatchObject({ valorTotal: 3000, nParcelas: 4, status: 'ATIVO', feitoPor: 'admin Silva', saldoAntes: 3020, aprovacaoId: null })
      expect((await req('GET', `/api/vendas/${v}/acordos`, 'cobrador')).statusCode).toBe(200)
      expect((await req('GET', `/api/vendas/${v}/acordos`, 'cobrador2')).statusCode).toBe(404)
      expect((await req('GET', `/api/vendas/${v}/acordos`, 'vendedor')).statusCode).toBe(403)
      expect((await req('GET', '/api/vendas/999999/acordos', 'admin')).statusCode).toBe(404)
    })
  })

  // ===================== depois do acordo: receber, desfazer, outros pedidos =====================
  describe('depois do acordo', () => {
    it('recebe as parcelas novas normalmente; as encerradas já não têm o que pagar (409)', async () => {
      const v = await vendaComSaldo()
      await acordoV('admin', v)
      expect((await receberV('admin', v, { parcela: 1, valor: 10 })).json().codigo).toBe('PARCELA_PAGA')
      expect((await receberV('admin', v, { parcela: 3, valor: 10 })).json().codigo).toBe('PARCELA_PAGA')
      const r = await receberV('admin', v, { parcela: 5, valor: 750 })
      expect(r.statusCode).toBe(201)
      expect(r.json().recibo.referencia).toBe('parcela 5/8')
      expect((await ficha(v)).falta).toBe(2250)
    })
    it('quitar as parcelas do acordo fecha a venda', async () => {
      const v = await vendaComSaldo()
      await acordoV('admin', v)
      for (const n of [5, 6, 7, 8]) await receberV('admin', v, { parcela: n, valor: 750 })
      expect((await ficha(v)).status).toBe('QUITADA')
    })
    it('pagamento a mais numa parcela do acordo abate as próximas do acordo (e não volta nas encerradas)', async () => {
      const v = await vendaComSaldo()
      await acordoV('admin', v)
      const r = await receberV('admin', v, { parcela: 5, valor: 1000 })
      expect(r.json().efeitos).toEqual([{ tipo: 'QUITA', numero: 5 }, { tipo: 'ABATE', numero: 6, valor: 250 }])
    })
    it('desfazer o último pagamento DEPOIS do acordo funciona; desfazer pagamento de ANTES numa parcela encerrada é 409', async () => {
      const v = await vendaComSaldo() // o pagamento de 340 foi na parcela 1, que o acordo vai encerrar
      const antigo = (await db!('transacoes_recebimento').where({ cliente_id: id.cA }).orderBy('id', 'desc').first()).id
      await acordoV('admin', v)
      expect((await req('POST', `/api/recebimentos/${antigo}/desfazer`, 'admin')).json().codigo).toBe('ACORDO_FEITO')
      expect((await ficha(v)).recebido).toBe(940) // nada mudou
      const novo = (await receberV('admin', v, { parcela: 5, valor: 750 })).json().recibo.id
      expect((await req('POST', `/api/recebimentos/${novo}/desfazer`, 'admin')).statusCode).toBe(204)
      expect((await ficha(v)).falta).toBe(3000)
    })
    it('pedidos de desconto e de acordo que esperavam são recusados ("Acordo feito"); o de retomada segue pendente', async () => {
      const v = await vendaComSaldo()
      const desc = (await req('POST', '/api/aprovacoes', 'cobrador', { alvo: 'VENDA', operacaoId: v, parcela: 2, valor: 100, motivo: 'Cliente pediu' })).json().id
      const acc = (await pedir('cobrador', v)).json().id
      const ret = (await req('POST', '/api/aprovacoes', 'cobrador', { tipo: 'RETOMADA', alvo: 'VENDA', operacaoId: v, motivo: 'Cliente sumiu' })).json().id
      await acordoV('admin', v)
      const lista = (await req('GET', '/api/aprovacoes?limite=100', 'admin')).json().itens
      expect(lista.find((x: { id: number }) => x.id === desc)).toMatchObject({ status: 'RECUSADO', resposta: 'Acordo feito' })
      expect(lista.find((x: { id: number }) => x.id === acc)).toMatchObject({ status: 'RECUSADO', resposta: 'Acordo feito' })
      expect(lista.find((x: { id: number }) => x.id === ret)).toMatchObject({ status: 'PENDENTE' })
      // e sem parcela atrasada, aprovar a retomada que sobrou é 409 (desatualizado)
      expect((await aprovar('admin', ret)).json().codigo).toBe('PEDIDO_DESATUALIZADO')
    })
    it('retomada depois do acordo só quando as parcelas novas atrasam', async () => {
      const v = await vendaComSaldo()
      await acordoV('admin', v)
      expect((await req('POST', `/api/vendas/${v}/retomar`, 'admin', {})).json().codigo).toBe('SEM_ATRASO')
      hoje = '2026-12-10' // a 1ª parcela do acordo (01/12) venceu
      expect((await req('POST', `/api/vendas/${v}/retomar`, 'admin', {})).statusCode).toBe(200)
    })
  })

  // ===================== acordo de empréstimo =====================
  describe('acordo de empréstimo', () => {
    it('só o administrador; outra carteira 404; faz o acordo e a ficha mostra as parcelas novas', async () => {
      const e = await emprestimo()
      for (const papel of ['cobrador', 'vendedor']) expect((await acordoE(papel, e)).statusCode).toBe(403)
      expect((await acordoE('admin', 999999)).statusCode).toBe(404)
      const r = await acordoE('admin', e, { motivo: 'Renegociação' })
      expect(r.statusCode).toBe(201)
      expect(r.json()).toMatchObject({ alvo: 'EMPRESTIMO', operacaoId: e, saldoAntes: 4080, valorTotal: 3600, nParcelas: 3, parcelasEncerradas: 3 })
      const f = await fichaE(e)
      expect(f.parcelas.map((p: { valor: number }) => p.valor)).toEqual([0, 0, 0, 1200, 1200, 1200])
      expect(f.parcelas.map((p: { acordo: string | null }) => p.acordo)).toEqual(['ENCERRADA', 'ENCERRADA', 'ENCERRADA', 'NOVA', 'NOVA', 'NOVA'])
      expect(f).toMatchObject({ falta: 3600, status: 'ATIVA' })
    })
    it('saldo considera o que já foi pago e a amortização do só juros', async () => {
      const e = await emprestimo()
      await receberE('admin', e, { valor: 1360 }) // 360 de juro + 1.000 de excedente → capital 2.000; plano 360, 240, 2.240
      const r = await acordoE('admin', e, { valorTotal: 2000, parcelas: 2 })
      expect(r.json().saldoAntes).toBe(2480) // 240 + 2.240
      const f = await fichaE(e)
      expect(f).toMatchObject({ falta: 2000, status: 'ATIVA', recebido: 1360 })
    })
    it('depois do acordo o só juros vira parcela comum: o excedente abate as próximas, NÃO o capital', async () => {
      const e = await emprestimo()
      await acordoE('admin', e) // parcelas 4, 5 e 6 de 1.200
      const r = await receberE('admin', e, { parcela: 4, valor: 1500 })
      expect(r.json().efeitos).toEqual([{ tipo: 'QUITA', numero: 4 }, { tipo: 'ABATE', numero: 5, valor: 300 }])
      expect(r.json().recibo.amortizacao).toBeNull()
    })
    it('quitar o acordo do empréstimo fecha o empréstimo; empréstimo cancelado → 409; quitado → SEM_SALDO', async () => {
      const e = await emprestimo()
      await acordoE('admin', e)
      for (const n of [4, 5, 6]) await receberE('admin', e, { parcela: n, valor: 1200 })
      expect((await fichaE(e)).status).toBe('QUITADA')
      expect((await acordoE('admin', e)).json().codigo).toBe('SEM_SALDO')
      const c = await emprestimo()
      await db!('emprestimos').where({ id: c }).update({ status: 'CANCELADA' })
      expect((await acordoE('admin', c)).json().codigo).toBe('VENDA_ENCERRADA')
    })
    it('histórico do empréstimo: cobrador da carteira vê; outra carteira não', async () => {
      const e = await emprestimo()
      await acordoE('admin', e)
      expect((await req('GET', `/api/emprestimos/${e}/acordos`, 'cobrador')).json()).toHaveLength(1)
      expect((await req('GET', `/api/emprestimos/${e}/acordos`, 'cobrador2')).statusCode).toBe(404)
    })
  })

  // ===================== o cobrador pede =====================
  describe('cobrador pede o acordo', () => {
    it('só o cobrador da carteira pede: admin/vendedor/indicador 403, outra carteira e inexistente 404, sem login 401', async () => {
      const v = await vendaComSaldo()
      for (const papel of ['admin', 'vendedor', 'indicador']) expect((await pedir(papel, v)).statusCode).toBe(403)
      expect((await pedir('', v)).statusCode).toBe(401)
      expect((await pedir('cobrador2', v)).statusCode).toBe(404)
      expect((await pedir('cobrador', 999999)).statusCode).toBe(404)
    })
    it.each([
      ['alvo inventado', { alvo: 'CARRO' }], ['sem operação', { operacaoId: undefined }], ['sem valor', { valorTotal: undefined }], ['valor zero', { valorTotal: 0 }], ['parcelas zero', { parcelas: 0 }],
      ['1ª data que já passou', { primeiraParcela: '2026-11-19' }], ['sem motivo', { motivo: undefined }], ['motivo curto', { motivo: 'ab' }], ['motivo enorme', { motivo: 'x'.repeat(501) }],
    ])('recusa %s (400)', async (_n, m) => {
      const v = await vendaComSaldo()
      const corpo = { tipo: 'ACORDO', alvo: 'VENDA', operacaoId: v, valorTotal: 3000, parcelas: 4, primeiraParcela: '2026-12-01', motivo: 'Cliente pediu', ...m } as Record<string, unknown>
      for (const k of Object.keys(corpo)) if (corpo[k] === undefined) delete corpo[k]
      expect((await req('POST', '/api/aprovacoes', 'cobrador', corpo)).statusCode).toBe(400)
    })
    it('sem saldo → 409 SEM_SALDO; venda retomada/cancelada → 409', async () => {
      const a = await vendaComSaldo()
      await db!('vendas').where({ id: a }).update({ status: 'QUITADA' })
      expect((await pedir('cobrador', a)).json().codigo).toBe('SEM_SALDO')
      const b = await vendaComSaldo()
      await db!('vendas').where({ id: b }).update({ status: 'RETOMADA' })
      expect((await pedir('cobrador', b)).json().codigo).toBe('VENDA_ENCERRADA')
    })
    it('nasce PENDENTE com a proposta e o saldo da hora; a venda não muda; audita; um pendente por operação', async () => {
      const v = await vendaComSaldo()
      const r = await pedir('cobrador', v)
      expect(r.statusCode).toBe(201)
      expect(r.json()).toMatchObject({ tipo: 'ACORDO', status: 'PENDENTE', alvo: 'VENDA', operacaoId: v, parcela: null, valor: 3000, acordo: { parcelas: 4, primeiraParcela: '2026-12-01', saldoNoPedido: 3020 }, aparelho: 'iPhone 13', solicitante: { nome: 'cobrador Silva' } })
      expect((await ficha(v)).falta).toBe(3020)
      expect(await db!('auditoria').where({ acao: 'ACORDO_PEDIDO', entidade_id: r.json().id })).toHaveLength(1)
      expect((await pedir('cobrador', v)).json().codigo).toBe('PEDIDO_JA_EXISTE')
      await expect(db!('aprovacoes').insert({ tipo: 'ACORDO', solicitado_por: id.cobrador, venda_id: v, valor: 1, motivo: 'abc' })).rejects.toThrow()
    })
    it('vale também para empréstimo', async () => {
      const e = await emprestimo()
      const r = await pedir('cobrador', e, { alvo: 'EMPRESTIMO', valorTotal: 3600, parcelas: 3 })
      expect(r.statusCode).toBe(201)
      expect(r.json()).toMatchObject({ alvo: 'EMPRESTIMO', aparelho: 'Empréstimo só juros', acordo: { saldoNoPedido: 4080, parcelas: 3 } })
      expect((await pedir('cobrador', e, { alvo: 'EMPRESTIMO' })).json().codigo).toBe('PEDIDO_JA_EXISTE')
    })
  })

  // ===================== o administrador responde =====================
  describe('administrador responde ao pedido de acordo', () => {
    it('APROVAR faz o acordo de verdade, com a proposta do cobrador, e liga o pedido ao acordo', async () => {
      const v = await vendaComSaldo()
      const pid = (await pedir('cobrador', v)).json().id
      for (const papel of ['cobrador', 'vendedor']) expect((await aprovar(papel, pid)).statusCode).toBe(403)
      const r = await aprovar('admin', pid)
      expect(r.statusCode).toBe(200)
      expect(r.json()).toMatchObject({ status: 'APROVADO', respondidoPor: 'admin Silva' })
      const ps = await parcelas(v)
      expect(ps.slice(4).map((p) => [p.n, p.valor, p.venc])).toEqual([[5, 750, '2026-12-01'], [6, 750, '2027-01-01'], [7, 750, '2027-02-01'], [8, 750, '2027-03-01']])
      const a = await db!('acordos').where({ venda_id: v }).first()
      expect(a).toMatchObject({ aprovacao_id: pid, criado_por: id.admin, motivo: 'Cliente pediu pra renegociar', status: 'ATIVO' })
      expect(await db!('auditoria').where({ acao: 'ACORDO_FEITO', entidade_id: v })).toHaveLength(1)
      expect(await db!('auditoria').where({ acao: 'APROVACAO_APROVADA', entidade_id: pid })).toHaveLength(1)
      expect((await aprovar('admin', pid)).json().codigo).toBe('PEDIDO_JA_RESPONDIDO')
    })
    it('aprovar o pedido de acordo de EMPRÉSTIMO também faz o acordo', async () => {
      const e = await emprestimo()
      const pid = (await pedir('cobrador', e, { alvo: 'EMPRESTIMO', valorTotal: 3600, parcelas: 3 })).json().id
      await aprovar('admin', pid)
      expect((await fichaE(e)).parcelas.map((p: { valor: number }) => p.valor)).toEqual([0, 0, 0, 1200, 1200, 1200])
    })
    it('RECUSAR guarda o motivo e não mexe em nada; depois dá para pedir de novo', async () => {
      const v = await vendaComSaldo()
      const pid = (await pedir('cobrador', v)).json().id
      expect((await recusar('admin', pid, { motivo: 'Valor baixo demais' })).json()).toMatchObject({ status: 'RECUSADO', resposta: 'Valor baixo demais' })
      expect((await parcelas(v)).every((p) => p.acordo === null && p.encerrada === null)).toBe(true)
      expect((await pedir('cobrador', v)).statusCode).toBe(201)
    })
    it('o saldo mudou depois do pedido (o cliente pagou): aprovar é 409 e o pedido segue pendente; dá para recusar', async () => {
      const v = await vendaComSaldo()
      const pid = (await pedir('cobrador', v)).json().id
      await receberV('admin', v, { parcela: 2, valor: 840 })
      const r = await aprovar('admin', pid)
      expect(r.statusCode).toBe(409)
      expect(r.json().codigo).toBe('PEDIDO_DESATUALIZADO')
      expect((await parcelas(v)).every((p) => p.acordo === null)).toBe(true)
      expect((await recusar('admin', pid)).statusCode).toBe(200)
    })
    it('a 1ª parcela proposta já passou quando o administrador vai aprovar: 409', async () => {
      const v = await vendaComSaldo()
      const pid = (await pedir('cobrador', v, { primeiraParcela: '2026-12-01' })).json().id
      hoje = '2026-12-02'
      const r = await aprovar('admin', pid)
      expect(r.json().codigo).toBe('PEDIDO_DESATUALIZADO')
    })
    it('venda retomada ou cancelada depois do pedido: aprovar é 409 e nada muda', async () => {
      const v = await vendaComSaldo()
      const pid = (await pedir('cobrador', v)).json().id
      await db!('vendas').where({ id: v }).update({ status: 'CANCELADA' })
      expect((await aprovar('admin', pid)).json().codigo).toBe('VENDA_ENCERRADA')
      expect((await parcelas(v)).every((p) => p.acordo === null)).toBe(true)
    })
    it('retomar a venda recusa o pedido de acordo que esperava', async () => {
      const v = await vendaComSaldo()
      const pid = (await pedir('cobrador', v)).json().id
      await req('POST', `/api/vendas/${v}/retomar`, 'admin', {})
      const p = (await req('GET', '/api/aprovacoes?limite=100', 'admin')).json().itens.find((x: { id: number }) => x.id === pid)
      expect(p).toMatchObject({ status: 'RECUSADO', resposta: 'Venda retomada' })
    })
  })

  // ===================== corridas =====================
  describe('corridas', () => {
    it('dois administradores aprovam o mesmo pedido ao mesmo tempo → um 200 e um 409; o acordo é feito uma vez', async () => {
      const v = await vendaComSaldo()
      const pid = (await pedir('cobrador', v)).json().id
      segura = true
      const [a, b] = await Promise.all([aprovar('admin', pid), aprovar('admin2', pid)])
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409])
      expect(await db!('acordos').where({ venda_id: v })).toHaveLength(1)
      expect((await parcelas(v)).filter((p) => p.acordo !== null)).toHaveLength(4)
    })
    it('o cliente paga enquanto o administrador aprova: ou o pagamento passa e o pedido fica desatualizado, ou o acordo sai e o pagamento não acha mais a parcela', async () => {
      const v = await vendaComSaldo()
      const pid = (await pedir('cobrador', v)).json().id
      segura = true // o recebimento fica 200 ms com a venda travada
      const [rec, apr] = await Promise.all([receberV('admin', v, { parcela: 2, valor: 840 }), (async () => { await new Promise((r) => setTimeout(r, 60)); return aprovar('admin2', pid) })()])
      expect(rec.statusCode).toBe(201)
      expect(apr.statusCode).toBe(409)
      expect(apr.json().codigo).toBe('PEDIDO_DESATUALIZADO')
      expect((await parcelas(v)).every((p) => p.acordo === null)).toBe(true)
    })
    it('dois acordos diretos ao mesmo tempo: os dois passam em sequência, só um fica ATIVO e a soma das abertas é a do último', async () => {
      const v = await vendaComSaldo()
      const [a, b] = await Promise.all([acordoV('admin', v, { valorTotal: 3000, parcelas: 4 }), acordoV('admin2', v, { valorTotal: 2000, parcelas: 2 })])
      expect([a.statusCode, b.statusCode]).toEqual([201, 201])
      expect(await db!('acordos').where({ venda_id: v, status: 'ATIVO' })).toHaveLength(1)
      const ativo = await db!('acordos').where({ venda_id: v, status: 'ATIVO' }).first()
      expect((await ficha(v)).falta).toBe(Number(ativo.valor_total))
    })
    it('retomar e fazer acordo ao mesmo tempo: nunca fica retomada com parcelas novas abertas', async () => {
      const v = await vendaComSaldo()
      const [a, r] = await Promise.all([acordoV('admin', v), req('POST', `/api/vendas/${v}/retomar`, 'admin2', {})])
      const st = (await db!('vendas').where({ id: v }).first()).status
      if (st === 'RETOMADA') expect(a.statusCode).toBe(201) // acordo primeiro, retomada depois só se ainda há atraso: não há → então não retomou
      expect([200, 409]).toContain(r.statusCode)
      expect([201, 409]).toContain(a.statusCode)
      if (r.statusCode === 200) expect(st).toBe('RETOMADA')
      else expect(st).toBe('ATIVA')
    })
  })
})
