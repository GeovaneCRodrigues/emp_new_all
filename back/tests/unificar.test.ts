import { createCaixaRepository } from '../src/modules/caixa/models/repository.js'
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

describe.skipIf(!db)('unificar empréstimos (Postgres de verdade)', () => {
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
    id.ind = ind.id
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

  const unificar = (papel: string, ids: number[], corpo: object = {}) => req('POST', '/api/emprestimos/unificar', papel, { emprestimoIds: ids, valorTotal: 7800, parcelas: 4, primeiraParcela: '2026-12-01', ...corpo })
  const vencs = async (e: number) => (await db!('emprestimo_parcelas').where({ emprestimo_id: e, encerrada_acordo_id: null }).orderBy('numero')).map((p: Record<string, unknown>) => String(p.vencimento instanceof Date ? p.vencimento.toISOString() : p.vencimento).slice(0, 10))
  const contaEmprestimos = async () => Number((await db!('emprestimos').count({ n: '*' }).first<{ n: string }>())!.n)

  /** Dois só juros de 3.000 a 12% em 3x; no primeiro entra a 1ª parcela (360). Deve 3.720 e 4.080 = 7.800; capital na rua 2.640 + 3.000 = 5.640. */
  async function dois(corpo2: object = {}, cliente2 = id.cA) {
    const a = await emprestimo()
    const b = await emprestimo(corpo2, cliente2)
    expect((await receberE('admin', a, { parcela: 1, valor: 360 })).statusCode).toBe(201)
    return [a, b]
  }

  describe('a conta', () => {
    it('junta o aberto num empréstimo novo; capital na rua vai para o novo e o lucro de todos não muda', async () => {
      const [a, b] = await dois()
      const lucroAntes = (await fichaE(a)).lucroTotal + (await fichaE(b)).lucroTotal
      hoje = '2026-11-20'
      const r = await unificar('admin', [a, b])
      expect(r.statusCode).toBe(201)
      const j = r.json()
      expect(j).toMatchObject({ saldoAntes: 7800, valorTotal: 7800, nParcelas: 4, capitalHerdado: 5640, capitalAdicional: 0, capital: 5640, periodicidade: 'MENSAL' })
      expect(j.origens).toEqual([
        expect.objectContaining({ emprestimoId: a, saldo: 3720, capitalCedido: 2640, parcelasEncerradas: 2 }),
        expect.objectContaining({ emprestimoId: b, saldo: 4080, capitalCedido: 3000, parcelasEncerradas: 3 }),
      ])
      const n = await fichaE(j.emprestimoId)
      expect(n).toMatchObject({ capital: 5640, total: 7800, recebido: 0, falta: 7800, lucroTotal: 2160, status: 'ATIVA', nParcelas: 4, unificadoDe: [a, b], unificadoEm: null })
      expect(n.parcelas.map((p: { valor: number }) => p.valor)).toEqual([1950, 1950, 1950, 1950])
      expect(await vencs(j.emprestimoId)).toEqual(['2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01'])
      const fa = await fichaE(a); const fb = await fichaE(b)
      expect(fa).toMatchObject({ capital: 360, status: 'QUITADA', falta: 0, recebido: 360, lucroTotal: 0, unificadoEm: j.emprestimoId, unificadoDe: [] })
      expect(fb).toMatchObject({ capital: 0, status: 'QUITADA', falta: 0, recebido: 0, lucroTotal: 0, unificadoEm: j.emprestimoId })
      expect(fa.lucroTotal + fb.lucroTotal + n.lucroTotal).toBe(lucroAntes)
      // as parcelas abertas ficam encerradas por acordo; o que foi pago continua
      expect(fa.parcelas.map((p: { acordo: string | null; pago: number }) => [p.acordo, p.pago])).toEqual([[null, 360], ['ENCERRADA', 0], ['ENCERRADA', 0]])
    })

    it('com dinheiro novo e juros dele: soma no capital, o Caixa mostra a saída na data e nada em dobro', async () => {
      const [a, b] = await dois()
      hoje = '2026-11-20'
      const r = await unificar('admin', [a, b], { capitalAdicional: 1500, valorTotal: 9800 })
      expect(r.statusCode).toBe(201)
      const j = r.json()
      expect(j).toMatchObject({ capitalHerdado: 5640, capitalAdicional: 1500, capital: 7140 })
      const n = await fichaE(j.emprestimoId)
      expect(n).toMatchObject({ capital: 7140, total: 9800, lucroTotal: 2660 })
      const c = await createCaixaRepository(db!).extrato({ hoje: '2026-12-31', limite: 500, offset: 0 })
      const por = (chave: string) => c.itens.find((i) => i.chave === chave)
      expect(por(`E${a}`)).toMatchObject({ valor: 3000 }) // o valor original, na data original
      expect(por(`E${b}`)).toMatchObject({ valor: 3000 })
      expect(por(`E${j.emprestimoId}`)).toBeUndefined() // o capital herdado não é dinheiro saindo do caixa
      const novo = c.itens.find((i) => i.chave.startsWith('D') && i.titulo.startsWith('Dinheiro novo no acordo'))
      expect(novo).toMatchObject({ valor: 1500, data: '2026-11-20' })
      const saidas = c.itens.filter((i) => /^[ED]/.test(i.chave) && ['E' + a, 'E' + b, 'E' + j.emprestimoId].concat(i.chave.startsWith('D') ? [i.chave] : []).includes(i.chave)).reduce((x, i) => x + i.valor, 0)
      expect(saidas).toBe(3000 + 3000 + 1500)
    })

    it('depois da unificação o novo recebe como qualquer empréstimo; a origem não recebe mais', async () => {
      const [a, b] = await dois()
      hoje = '2026-12-01'
      const j = (await unificar('admin', [a, b], { primeiraParcela: '2026-12-01' })).json()
      const r = await receberE('admin', j.emprestimoId, { parcela: 1, valor: 1950 })
      expect(r.statusCode).toBe(201)
      expect(await fichaE(j.emprestimoId)).toMatchObject({ recebido: 1950, falta: 5850 })
      expect((await receberE('admin', b, { parcela: 2, valor: 100 })).statusCode).toBeGreaterThanOrEqual(400)
    })

    it('periodicidade semanal e diária (seg a sáb) valem na unificação', async () => {
      const [a, b] = await dois()
      const j = (await unificar('admin', [a, b], { periodicidade: 'SEMANAL' })).json()
      expect(await vencs(j.emprestimoId)).toEqual(['2026-12-01', '2026-12-08', '2026-12-15', '2026-12-22'])
      expect((await fichaE(j.emprestimoId)).periodicidade).toBe('SEMANAL')
      const [c, d] = await dois()
      const k = (await unificar('admin', [c, d], { periodicidade: 'DIARIA', primeiraParcela: '2026-12-05' })).json()
      expect(await vencs(k.emprestimoId)).toEqual(['2026-12-05', '2026-12-07', '2026-12-08', '2026-12-09'])
      const f = await fichaE(k.emprestimoId)
      expect(f).toMatchObject({ modalidade: 'DIARIA', periodicidade: 'DIARIA' })
    })

    it('três empréstimos de uma vez; o histórico de acordos das origens aponta para o novo', async () => {
      const [a, b] = await dois()
      const c = await emprestimo()
      const j = (await unificar('admin', [a, b, c], { valorTotal: 11000, parcelas: 5 })).json()
      expect(j.saldoAntes).toBe(11880)
      expect(j.capitalHerdado).toBe(8640)
      const h = (await req('GET', `/api/emprestimos/${c}/acordos`, 'admin')).json()
      expect(h[0]).toMatchObject({ unificadoEmId: j.emprestimoId, capitalCedido: 3000, valorTotal: 4080 })
      const hn = (await req('GET', `/api/emprestimos/${j.emprestimoId}/acordos`, 'admin')).json()
      expect(hn[0]).toMatchObject({ capitalHerdado: 8640, valorTotal: 11000, nParcelas: 5 })
    })
  })

  describe('regras e erros', () => {
    it('só o administrador; sem login 401', async () => {
      const [a, b] = await dois()
      for (const papel of ['cobrador', 'vendedor', 'indicador']) expect((await unificar(papel, [a, b])).statusCode, papel).toBe(403)
      expect((await unificar('', [a, b])).statusCode).toBe(401)
      expect((await fichaE(a)).status).toBe('ATIVA')
    })

    it('seleção inválida → 400: menos de 2, repetido, não numérico, mais de 10', async () => {
      const [a, b] = await dois()
      for (const ids of [[a], [], [a, a], [a, '2'], [a, -1], Array.from({ length: 11 }, (_, i) => a + i)] as unknown[][]) expect((await unificar('admin', ids as number[])).statusCode, JSON.stringify(ids)).toBe(400)
      expect((await req('POST', '/api/emprestimos/unificar', 'admin', { valorTotal: 1, parcelas: 1, primeiraParcela: '2026-12-01' })).statusCode).toBe(400)
      expect((await fichaE(b)).status).toBe('ATIVA')
    })

    it('proposta inválida → 400 e nada muda', async () => {
      const [a, b] = await dois()
      const antes = await contaEmprestimos()
      for (const corpo of [{ valorTotal: 0 }, { valorTotal: -5 }, { parcelas: 0 }, { parcelas: 121 }, { primeiraParcela: '2026-10-01' }, { primeiraParcela: 'xx' }, { capitalAdicional: -1 }, { periodicidade: 'ANUAL' }]) {
        expect((await unificar('admin', [a, b], corpo)).statusCode, JSON.stringify(corpo)).toBe(400)
      }
      expect(await contaEmprestimos()).toBe(antes)
      expect(await fichaE(a)).toMatchObject({ status: 'ATIVA', capital: 3000 })
    })

    it('clientes diferentes → 400; empréstimo que não existe → 404', async () => {
      const [a, b] = await dois({}, id.cB)
      const r = await unificar('admin', [a, b])
      expect(r.statusCode).toBe(400)
      expect(r.json().codigo).toBe('CLIENTES_DIFERENTES')
      expect((await unificar('admin', [a, 99999999])).statusCode).toBe(404)
      expect((await fichaE(a)).status).toBe('ATIVA')
    })

    it('cancelado → 409 e quitado (nada em aberto) → 409 SEM_SALDO; e nada é gravado pela metade', async () => {
      const [a, b] = await dois()
      const c = await emprestimo()
      await db!('emprestimos').where({ id: c }).update({ status: 'CANCELADA' })
      expect((await unificar('admin', [a, c])).json().codigo).toBe('VENDA_ENCERRADA')
      const q = await emprestimo()
      for (const n of [1, 2, 3]) expect((await receberE('admin', q, { parcela: n, valor: n === 3 ? 3360 : 360 })).statusCode).toBe(201)
      const antes = await contaEmprestimos()
      const r = await unificar('admin', [a, b, q])
      expect(r.statusCode).toBe(409)
      expect(r.json().codigo).toBe('SEM_SALDO')
      expect(await contaEmprestimos()).toBe(antes)
      expect(await fichaE(a)).toMatchObject({ status: 'ATIVA', capital: 3000, unificadoEm: null })
      expect(await db!('acordos').where({ emprestimo_id: a })).toHaveLength(0)
    })

    it('o pedido de desconto/acordo que esperava numa origem é recusado', async () => {
      const [a, b] = await dois()
      const p = await req('POST', '/api/aprovacoes', 'cobrador', { tipo: 'ACORDO', alvo: 'EMPRESTIMO', operacaoId: b, valorTotal: 3600, parcelas: 3, primeiraParcela: '2026-12-01', motivo: 'Cliente pediu' })
      expect(p.statusCode).toBe(201)
      await unificar('admin', [a, b])
      const ap = await db!('aprovacoes').where({ id: p.json().id }).first()
      expect(ap).toMatchObject({ status: 'RECUSADO', resposta: 'Empréstimo unificado' })
    })

    it('já foi unificado: não entra de novo (nada em aberto)', async () => {
      const [a, b] = await dois()
      await unificar('admin', [a, b])
      expect((await unificar('admin', [a, b])).json().codigo).toBe('SEM_SALDO')
    })
  })

  describe('indicador do empréstimo novo', () => {
    it('todos com o mesmo indicador: o novo herda o indicador e o % da época', async () => {
      const [a, b] = await dois({ indicadorId: id.ind })
      await db!('emprestimos').where({ id: a }).update({ indicador_id: id.ind, percentual_indicador: 0.5 })
      const j = (await unificar('admin', [a, b])).json()
      const n = await fichaE(j.emprestimoId)
      expect(n.indicador).toMatchObject({ id: id.ind })
      expect(n.percentualIndicador).toBe(0.5)
    })

    it('indicadores diferentes: pede para escolher (INDICADOR_NECESSARIO); escolher um ou nenhum funciona', async () => {
      const [a, b] = await dois({ indicadorId: id.ind })
      await db!('emprestimos').where({ id: a }).update({ indicador_id: null, percentual_indicador: 0 })
      const antes = await contaEmprestimos()
      const r = await unificar('admin', [a, b])
      expect(r.statusCode).toBe(400)
      expect(r.json().codigo).toBe('INDICADOR_NECESSARIO')
      expect(await contaEmprestimos()).toBe(antes)
      expect((await unificar('admin', [a, b], { indicadorId: 99999999 })).statusCode).toBe(400)
      const escolhido = (await unificar('admin', [a, b], { indicadorId: id.ind })).json()
      const n = await fichaE(escolhido.emprestimoId)
      expect(n.indicador).toMatchObject({ id: id.ind })
      expect(n.percentualIndicador).toBe(0.5)
      const [c, d] = await dois({ indicadorId: id.ind })
      await db!('emprestimos').where({ id: c }).update({ indicador_id: null, percentual_indicador: 0 })
      const nenhum = (await unificar('admin', [c, d], { indicadorId: null })).json()
      const nn = await fichaE(nenhum.emprestimoId)
      expect(nn.indicador).toBeNull()
      expect(nn.percentualIndicador).toBe(0)
    })
  })
})
