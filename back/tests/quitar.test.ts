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

describe.skipIf(!db)('quitar empréstimo (Postgres de verdade)', () => {
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

  const venc = async (e: number, n: number) => String((await db!('emprestimo_parcelas').where({ emprestimo_id: e, numero: n }).first()).vencimento instanceof Date ? (await db!('emprestimo_parcelas').where({ emprestimo_id: e, numero: n }).first()).vencimento.toISOString() : (await db!('emprestimo_parcelas').where({ emprestimo_id: e, numero: n }).first()).vencimento).slice(0, 10)
  const parc = async (e: number) => (await db!('emprestimo_parcelas').where({ emprestimo_id: e }).orderBy('numero')).map((p: Record<string, unknown>) => ({ n: p.numero as number, valor: Number(p.valor), desconto: Number(p.desconto), quitada: p.quitada_em !== null }))
  const quitar = (papel: string, e: number, corpo: object = {}) => req('POST', `/api/emprestimos/${e}/recebimentos`, papel, { forma: 'PIX', parcela: 1, quitar: true, ...corpo })

  describe('só juros 3.000 a 12% em 3x (360, 360, 3.360)', () => {
    it('em dia: quita só com o capital; o juro que não venceu fica de fora (não é desconto)', async () => {
      const e = await emprestimo()
      const r = await quitar('admin', e, { valor: 3000 })
      expect(r.statusCode).toBe(201)
      expect(r.json().quitada).toBe(true)
      expect(r.json().efeitos.find((x: { tipo: string }) => x.tipo === 'QUITACAO')).toEqual({ tipo: 'QUITACAO', desconto: 0, perdoado: 1080 })
      const f = await fichaE(e)
      expect(f.status).toBe('QUITADA')
      expect(f.recebido).toBe(3000)
      expect(f.falta).toBe(0)
      expect(f.capitalAberto).toBe(0)
      expect(f.lucroTotal).toBe(0)
      expect((await parc(e)).every((p) => p.quitada && p.desconto === 0)).toBe(true)
    })

    it('o recibo e a lista de pagamentos dizem "quitação", e não "parcela N" com o valor todo', async () => {
      const e = await emprestimo()
      hoje = await venc(e, 1) // a 1ª vence hoje: juro de 360 + capital de 3.000
      const r = await quitar('admin', e, { valor: 3360 })
      expect(r.statusCode).toBe(201)
      expect(r.json().recibo.referencia).toBe('quitação (parcela 1/3 + capital)')
      const t = await db!('transacoes_recebimento').orderBy('id', 'desc').first()
      expect(t.resumo.referencia).toBe('quitação (parcela 1/3 + capital)')
    })
    it('depois de pagar a 1ª parcela, quitar custa só o capital: o lucro é só o juro da 1ª (360)', async () => {
      const e = await emprestimo()
      hoje = await venc(e, 1)
      expect((await receberE('admin', e, { parcela: 1, valor: 360 })).statusCode).toBe(201)
      expect((await quitar('admin', e, { valor: 3000, parcela: 2 })).statusCode).toBe(201)
      const f = await fichaE(e)
      expect(f.status).toBe('QUITADA')
      expect(f.recebido).toBe(3360)
      expect(f.lucroTotal).toBe(360)
    })

    it('cobrarProximo inclui o juro da próxima parcela', async () => {
      const e = await emprestimo()
      expect((await quitar('admin', e, { valor: 3360 })).statusCode).toBe(400) // sem cobrarProximo o máximo é 3.000
      const r = await quitar('admin', e, { valor: 3360, cobrarProximo: true })
      expect(r.statusCode).toBe(201)
      expect((await fichaE(e)).lucroTotal).toBe(360)
    })

    it('juro vencido e não pago entra na conta; desconto = a diferença e sai do lucro', async () => {
      const e = await emprestimo()
      hoje = await venc(e, 1) // a 1ª vence hoje: 360 de juro + 3.000 de capital
      const r = await quitar('admin', e, { valor: 3000 })
      expect(r.statusCode).toBe(201)
      expect(r.json().efeitos.find((x: { tipo: string }) => x.tipo === 'QUITACAO').desconto).toBe(360)
      const f = await fichaE(e)
      expect(f.status).toBe('QUITADA')
      expect(f.recebido).toBe(3000)
      expect(f.lucroTotal).toBe(0)
    })

    it('desconto maior que o capital desconta o juro vencido também (a parcela guarda o desconto)', async () => {
      const e = await emprestimo()
      hoje = await venc(e, 1)
      const r = await quitar('admin', e, { valor: 2800 })
      expect(r.statusCode).toBe(201)
      expect((await fichaE(e)).status).toBe('QUITADA')
      expect(r.json().efeitos.find((x: { tipo: string }) => x.tipo === 'QUITACAO').desconto).toBe(560)
    })

    it('valor acima do que se cobra, zero ou ausente é recusado', async () => {
      const e = await emprestimo()
      expect((await quitar('admin', e, { valor: 3000.01 })).statusCode).toBe(400)
      expect((await quitar('admin', e, { valor: 0 })).statusCode).toBe(400)
      expect((await quitar('admin', e, { valor: undefined })).statusCode).toBe(400)
      expect((await fichaE(e)).status).toBe('ATIVA')
    })

    it('só o administrador quita; cobrador leva 403', async () => {
      const e = await emprestimo()
      expect((await quitar('cobrador', e, { valor: 3000 })).statusCode).toBe(403)
      expect((await fichaE(e)).status).toBe('ATIVA')
    })

    it('não manda resto nem pedido de desconto junto', async () => {
      const e = await emprestimo()
      expect((await quitar('admin', e, { valor: 3000, resto: 'DESCONTO' })).statusCode).toBe(400)
    })

    it('já quitado: não há o que quitar', async () => {
      const e = await emprestimo()
      expect((await quitar('admin', e, { valor: 3000 })).statusCode).toBe(201)
      expect((await quitar('admin', e, { valor: 3000 })).statusCode).toBeGreaterThanOrEqual(400)
    })

    it('desfazer devolve tudo: parcelas, capital em aberto e status', async () => {
      const e = await emprestimo()
      const antes = await parc(e)
      const r = await quitar('admin', e, { valor: 3000 })
      expect((await req('POST', `/api/recebimentos/${r.json().recibo.id}/desfazer`, 'admin')).statusCode).toBe(204)
      expect(await parc(e)).toEqual(antes)
      const f = await fichaE(e)
      expect(f.status).toBe('ATIVA')
      expect(f.capitalAberto).toBe(3000)
      expect(f.recebido).toBe(0)
    })

    it('venda de iPhone não se quita por aqui', async () => {
      const v = await venda()
      expect((await req('POST', `/api/vendas/${v}/recebimentos`, 'admin', { forma: 'PIX', parcela: 1, valor: 840, quitar: true })).statusCode).toBe(400)
    })
  })
})
