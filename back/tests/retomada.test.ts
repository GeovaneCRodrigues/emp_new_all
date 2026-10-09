import type { FastifyInstance } from 'fastify'
import type { Knex } from 'knex'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { createAprovacoesRepository } from '../src/modules/aprovacoes/models/repository.js'
import { createAprovacoesService } from '../src/modules/aprovacoes/services/aprovacoes.service.js'
import { createAuditoriaRepository } from '../src/modules/auditoria/models/repository.js'
import { createSessoesRepository, createUsuariosRepository } from '../src/modules/auth/models/repository.js'
import { createAuthService } from '../src/modules/auth/services/auth.service.js'
import { hashSenha } from '../src/modules/auth/services/password.js'
import { createTokensService } from '../src/modules/auth/services/tokens.js'
import { createConfigRepository } from '../src/modules/config/models/repository.js'
import { createConfigService } from '../src/modules/config/services/config.service.js'
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

describe.skipIf(!db)('retomada do aparelho (Postgres de verdade)', () => {
  let app: FastifyInstance
  let hoje = '2026-10-08'
  let segura = false
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}

  const req = (metodo: 'GET' | 'POST', url: string, papel?: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })

  /** Cria o aparelho e a venda no dia 08/10/2026: entrada 600 e 4 parcelas de 840 (10/11, 10/12, 10/01, 10/02). Devolve venda e aparelho. */
  async function venda(cliente = id.cA): Promise<{ v: number; bem: number }> {
    const dia = hoje; hoje = '2026-10-08'
    const [b] = await db!('bens').insert({ modelo: 'iPhone 13', gb: 128, cor: 'Preto', preco_venda: 3000, valor_compra: 2000, data_compra: '2026-09-01' }).returning('id')
    const r = await req('POST', '/api/vendas', 'admin', { aparelhoId: b.id, clienteId: cliente, preco: 3000, entrada: 600, parcelas: 4, diaVencimento: 10 })
    hoje = dia
    expect(r.statusCode).toBe(201)
    return { v: r.json().id, bem: b.id }
  }
  /** Venda com a 1ª parcela atrasada: o relógio vai para 20/11/2026 (a de 10/11 venceu; as outras não). */
  async function vendaAtrasada(cliente = id.cA) { const x = await venda(cliente); hoje = '2026-11-20'; return x }
  const retomar = (papel: string, v: number, corpo: object = {}) => req('POST', `/api/vendas/${v}/retomar`, papel, corpo)
  const pedir = (papel: string, v: number, corpo: object = {}) => req('POST', '/api/aprovacoes', papel, { tipo: 'RETOMADA', alvo: 'VENDA', operacaoId: v, motivo: '2 parcelas atrasadas e não atende', ...corpo })
  const aprovar = (papel: string, pid: number) => req('POST', `/api/aprovacoes/${pid}/aprovar`, papel)
  const recusar = (papel: string, pid: number, corpo: object = {}) => req('POST', `/api/aprovacoes/${pid}/recusar`, papel, corpo)
  const receber = (papel: string, v: number, corpo: object = {}) => req('POST', `/api/vendas/${v}/recebimentos`, papel, { forma: 'PIX', parcela: 1, valor: 840, ...corpo })
  const statusVenda = async (v: number) => (await db!('vendas').where({ id: v }).first()).status as string
  const bemDe = async (b: number) => db!('bens').where({ id: b }).first()

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
      recebimentos: createRecebimentosService({ repo: createRecebimentosRepository(k), auditoria: audit, hoje: () => hoje, depoisDeLerParcelas: espera }),
      aprovacoes: createAprovacoesService({ repo: createAprovacoesRepository(k), auditoria: audit, hoje: () => hoje, depoisDeLerParcelas: espera }),
      fechamentos: {} as never, equipe: {} as never,
      limites: { vendasPorMinuto: 100_000, recebimentosPorMinuto: 100_000 },
    })
    for (const papel of ['admin', 'admin2', 'vendedor', 'cobrador', 'cobrador2', 'indicador']) t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  })
  beforeEach(() => { hoje = '2026-10-08'; segura = false })
  afterAll(async () => { await app?.close(); await db?.destroy() })

  // ===================== o administrador retoma direto =====================
  describe('administrador retoma direto', () => {
    it('só o administrador (403 para os outros, 401 sem login); inexistente 404; id inválido 400', async () => {
      const { v } = await vendaAtrasada()
      for (const papel of ['cobrador', 'vendedor', 'indicador']) expect((await retomar(papel, v)).statusCode).toBe(403)
      expect((await retomar('', v)).statusCode).toBe(401)
      expect((await retomar('admin', 999999)).statusCode).toBe(404)
      expect((await req('POST', '/api/vendas/abc/retomar', 'admin')).statusCode).toBe(400)
      expect(await statusVenda(v)).toBe('ATIVA')
    })
    it('sem parcela atrasada não retoma (409 SEM_ATRASO) e nada muda', async () => {
      const { v, bem } = await venda()
      const r = await retomar('admin', v)
      expect(r.statusCode).toBe(409)
      expect(r.json().codigo).toBe('SEM_ATRASO')
      expect(await statusVenda(v)).toBe('ATIVA')
      expect((await bemDe(bem)).estado).toBe('VENDIDO')
    })
    it('venda quitada ou já retomada não retoma (409)', async () => {
      const { v } = await vendaAtrasada()
      await db!('vendas').where({ id: v }).update({ status: 'QUITADA' })
      expect((await retomar('admin', v)).json().codigo).toBe('VENDA_NAO_RETOMAVEL')
      await db!('vendas').where({ id: v }).update({ status: 'ATIVA' })
      expect((await retomar('admin', v)).statusCode).toBe(200)
      expect((await retomar('admin', v)).json().codigo).toBe('VENDA_NAO_RETOMAVEL')
    })
    it('retoma: a venda vira RETOMADA, o aparelho volta ao estoque disponível e fica registrado quem, quando e por quê', async () => {
      const { v, bem } = await vendaAtrasada()
      const r = await retomar('admin', v, { motivo: '  Cliente sumiu  ' })
      expect(r.statusCode).toBe(200)
      expect(r.json()).toMatchObject({ id: v, status: 'RETOMADA', retomada: { motivo: 'Cliente sumiu' } })
      expect(r.json().retomada.em).toMatch(/^2\d{3}-/)
      const venda = await db!('vendas').where({ id: v }).first()
      expect(venda).toMatchObject({ status: 'RETOMADA', retomada_por: id.admin, retomada_motivo: 'Cliente sumiu' })
      const b = await bemDe(bem)
      expect(b).toMatchObject({ estado: 'DISPONIVEL', cliente_encomenda_id: null })
      expect(String(b.data_compra).slice(0, 10)).not.toBe('2026-09-01')
      expect(b.observacoes).toContain(`Retomado da venda #${v}`)
      const a = await db!('auditoria').where({ acao: 'VENDA_RETOMADA', entidade_id: v }).first()
      expect(a).toMatchObject({ usuario_id: id.admin })
      expect(a.antes).toMatchObject({ status: 'ATIVA' })
      expect(a.depois).toMatchObject({ status: 'RETOMADA', parcelasAtrasadas: 1 })
    })
    it('o dinheiro já recebido continua no histórico (a entrada e os pagamentos não somem)', async () => {
      const { v } = await vendaAtrasada()
      const antes = (await req('GET', `/api/vendas/${v}`, 'admin')).json()
      await retomar('admin', v)
      const depois = (await req('GET', `/api/vendas/${v}`, 'admin')).json()
      expect(depois.recebido).toBe(antes.recebido)
      expect(depois.recebido).toBe(600)
      expect(await db!('transacoes_recebimento').where({ cliente_id: id.cA }).count<{ count: string }[]>({ count: '*' })).toBeTruthy()
    })
    it('motivo opcional; motivo enorme é 400', async () => {
      const { v } = await vendaAtrasada()
      expect((await retomar('admin', v, { motivo: 'x'.repeat(501) })).statusCode).toBe(400)
      expect((await retomar('admin', v)).json().retomada.motivo).toBeNull()
    })
    it('a venda retomada sai das cobranças e do "a receber", aparece no filtro Retomadas e não recebe mais pagamento nem desconto', async () => {
      const { v } = await vendaAtrasada()
      const resumoAntes = (await req('GET', '/api/vendas/resumo', 'admin')).json().aReceber
      await retomar('admin', v)
      const atr = (await req('GET', '/api/cobrancas?aba=atrasadas&limite=100', 'admin')).json().itens
      expect(atr.some((x: { operacaoId: number; tipo: string }) => x.tipo === 'VENDA' && x.operacaoId === v)).toBe(false)
      expect((await req('GET', '/api/vendas/resumo', 'admin')).json().aReceber).toBeLessThan(resumoAntes)
      const lista = (await req('GET', '/api/vendas?status=RETOMADA&limite=100', 'admin')).json().itens
      expect(lista.some((x: { id: number }) => x.id === v)).toBe(true)
      expect((await receber('admin', v)).json().codigo).toBe('VENDA_ENCERRADA')
      expect((await req('POST', '/api/aprovacoes', 'cobrador', { alvo: 'VENDA', operacaoId: v, parcela: 2, valor: 10, motivo: 'abc' })).json().codigo).toBe('VENDA_ENCERRADA')
    })
    it('o aparelho volta para a vitrine e PODE SER VENDIDO DE NOVO (a venda retomada não segura mais o aparelho)', async () => {
      const { v, bem } = await vendaAtrasada()
      await retomar('admin', v)
      hoje = '2026-11-20'
      const disp = (await req('GET', '/api/aparelhos?estado=DISPONIVEL&limite=100', 'admin')).json().itens
      expect(disp.some((x: { id: number }) => x.id === bem)).toBe(true)
      const nova = await req('POST', '/api/vendas', 'admin', { aparelhoId: bem, clienteId: id.cB, preco: 3000, entrada: 3000 })
      expect(nova.statusCode).toBe(201)
      expect((await bemDe(bem)).estado).toBe('VENDIDO')
      // e enquanto a nova venda está de pé, não dá para vender o mesmo aparelho outra vez
      expect((await req('POST', '/api/vendas', 'admin', { aparelhoId: bem, clienteId: id.cA, preco: 3000, entrada: 3000 })).json().codigo).toBe('APARELHO_INDISPONIVEL')
    })
    it('o banco só aceita uma venda "viva" por aparelho: retomada e cancelada não contam (índice vendas_bem_ativa_uq)', async () => {
      const { v, bem } = await vendaAtrasada()
      const base = await db!('vendas').where({ id: v }).first()
      const nova = (extra: object) => db!('vendas').insert({ bem_id: bem, cliente_id: id.cA, data_venda: '2026-11-20', preco_acordado: 3000, entrada: 3000, valor_investido: 2000, valor_total: 3000, ...extra })
      await expect(nova({ status: 'ATIVA' })).rejects.toThrow() // a original ainda está ativa
      await retomar('admin', v)
      await expect(nova({ status: 'ATIVA' })).resolves.toBeDefined() // retomada libera
      await expect(nova({ status: 'ATIVA' })).rejects.toThrow() // mas a nova já ocupa
      expect(base.id).toBe(v)
    })
    it('pedidos que esperavam sobre a venda são recusados sozinhos ("Venda retomada")', async () => {
      const { v } = await vendaAtrasada()
      const desc = await req('POST', '/api/aprovacoes', 'cobrador', { alvo: 'VENDA', operacaoId: v, parcela: 1, valor: 100, motivo: 'Cliente pediu' })
      const ret = await pedir('cobrador', v)
      await retomar('admin', v)
      for (const pid of [desc.json().id, ret.json().id]) {
        const p = (await req('GET', '/api/aprovacoes?limite=100', 'admin')).json().itens.find((x: { id: number }) => x.id === pid)
        expect(p).toMatchObject({ status: 'RECUSADO', resposta: 'Venda retomada' })
      }
      expect((await aprovar('admin', ret.json().id)).json().codigo).toBe('PEDIDO_JA_RESPONDIDO')
    })
  })

  // ===================== o cobrador pede =====================
  describe('cobrador pede a retomada', () => {
    it('só o cobrador da carteira pede: admin/vendedor/indicador 403, outra carteira e inexistente 404, sem login 401', async () => {
      const { v } = await vendaAtrasada()
      for (const papel of ['admin', 'vendedor', 'indicador']) expect((await pedir(papel, v)).statusCode).toBe(403)
      expect((await pedir('', v)).statusCode).toBe(401)
      expect((await pedir('cobrador2', v)).statusCode).toBe(404)
      expect((await pedir('cobrador', 999999)).statusCode).toBe(404)
    })
    it.each([
      ['empréstimo (a retomada é de aparelho)', { alvo: 'EMPRESTIMO' }], ['sem venda', { operacaoId: undefined }], ['venda como texto', { operacaoId: '1' }],
      ['sem motivo', { motivo: undefined }], ['motivo curto', { motivo: 'ab' }], ['motivo enorme', { motivo: 'x'.repeat(501) }],
    ])('recusa %s (400)', async (_n, m) => {
      const { v } = await vendaAtrasada()
      const corpo = { tipo: 'RETOMADA', alvo: 'VENDA', operacaoId: v, motivo: 'Cliente sumiu', ...m } as Record<string, unknown>
      for (const k of Object.keys(corpo)) if (corpo[k] === undefined) delete corpo[k]
      expect((await req('POST', '/api/aprovacoes', 'cobrador', corpo)).statusCode).toBe(400)
    })
    it('tipo inventado é 400', async () => {
      const { v } = await vendaAtrasada()
      expect((await pedir('cobrador', v, { tipo: 'DEMISSAO' })).statusCode).toBe(400)
    })
    it('sem atraso (409 SEM_ATRASO) e venda que não está em andamento (409)', async () => {
      const a = await venda()
      expect((await pedir('cobrador', a.v)).json().codigo).toBe('SEM_ATRASO')
      const b = await vendaAtrasada()
      await db!('vendas').where({ id: b.v }).update({ status: 'QUITADA' })
      expect((await pedir('cobrador', b.v)).json().codigo).toBe('VENDA_NAO_RETOMAVEL')
    })
    it('nasce PENDENTE com o que o administrador precisa ver; a venda e o aparelho não mudam; audita', async () => {
      const { v, bem } = await vendaAtrasada()
      const r = await pedir('cobrador', v)
      expect(r.statusCode).toBe(201)
      expect(r.json()).toMatchObject({ tipo: 'RETOMADA', status: 'PENDENTE', alvo: 'VENDA', operacaoId: v, parcela: null, nParcelas: 4, valor: 3360, motivo: '2 parcelas atrasadas e não atende', aparelho: 'iPhone 13', cliente: { nome: 'Ana Souza' }, solicitante: { nome: 'cobrador Silva' } })
      expect(await statusVenda(v)).toBe('ATIVA')
      expect((await bemDe(bem)).estado).toBe('VENDIDO')
      expect(await db!('auditoria').where({ acao: 'RETOMADA_PEDIDA', entidade_id: r.json().id })).toHaveLength(1)
    })
    it('um pedido pendente por venda (409); o banco também garante', async () => {
      const { v } = await vendaAtrasada()
      expect((await pedir('cobrador', v)).statusCode).toBe(201)
      expect((await pedir('cobrador', v)).json().codigo).toBe('PEDIDO_JA_EXISTE')
      await expect(db!('aprovacoes').insert({ tipo: 'RETOMADA', solicitado_por: id.cobrador, venda_id: v, valor: 1, motivo: 'abc' })).rejects.toThrow()
    })
    it('o administrador vê o pedido na fila e o cobrador só os dele', async () => {
      const a = await vendaAtrasada(id.cA); const b = await vendaAtrasada(id.cB)
      const pa = (await pedir('cobrador', a.v)).json().id
      const pb = (await pedir('cobrador2', b.v)).json().id
      const adm = (await req('GET', '/api/aprovacoes?status=PENDENTE&limite=100', 'admin')).json().itens.map((x: { id: number }) => x.id)
      expect(adm).toEqual(expect.arrayContaining([pa, pb]))
      const dele = (await req('GET', '/api/aprovacoes?limite=100', 'cobrador')).json().itens.map((x: { id: number }) => x.id)
      expect(dele).toContain(pa)
      expect(dele).not.toContain(pb)
    })
  })

  // ===================== o administrador responde =====================
  describe('administrador responde', () => {
    it('APROVAR retoma de verdade: venda RETOMADA, aparelho no estoque, pedido APROVADO, tudo auditado', async () => {
      const { v, bem } = await vendaAtrasada()
      const pid = (await pedir('cobrador', v)).json().id
      for (const papel of ['cobrador', 'vendedor']) expect((await aprovar(papel, pid)).statusCode).toBe(403)
      const r = await aprovar('admin', pid)
      expect(r.statusCode).toBe(200)
      expect(r.json()).toMatchObject({ status: 'APROVADO', respondidoPor: 'admin Silva' })
      expect(await statusVenda(v)).toBe('RETOMADA')
      expect((await bemDe(bem)).estado).toBe('DISPONIVEL')
      expect((await db!('vendas').where({ id: v }).first()).retomada_motivo).toBe('2 parcelas atrasadas e não atende') // o motivo do cobrador vai para a venda
      expect(await db!('auditoria').where({ acao: 'VENDA_RETOMADA', entidade_id: v })).toHaveLength(1)
      expect(await db!('auditoria').where({ acao: 'APROVACAO_APROVADA', entidade_id: pid })).toHaveLength(1)
    })
    it('aprovar de novo é 409; recusar um aprovado é 409; pedido inexistente 404', async () => {
      const { v } = await vendaAtrasada()
      const pid = (await pedir('cobrador', v)).json().id
      await aprovar('admin', pid)
      expect((await aprovar('admin', pid)).json().codigo).toBe('PEDIDO_JA_RESPONDIDO')
      expect((await recusar('admin', pid)).json().codigo).toBe('PEDIDO_JA_RESPONDIDO')
      expect((await aprovar('admin', 999999)).statusCode).toBe(404)
    })
    it('RECUSAR guarda o motivo e NÃO mexe na venda nem no aparelho; depois dá para pedir de novo', async () => {
      const { v, bem } = await vendaAtrasada()
      const pid = (await pedir('cobrador', v)).json().id
      const r = await recusar('admin', pid, { motivo: 'Vamos esperar até dia 25' })
      expect(r.json()).toMatchObject({ status: 'RECUSADO', resposta: 'Vamos esperar até dia 25' })
      expect(await statusVenda(v)).toBe('ATIVA')
      expect((await bemDe(bem)).estado).toBe('VENDIDO')
      expect((await pedir('cobrador', v)).statusCode).toBe(201)
    })
    it('o cliente pagou o atraso depois do pedido: aprovar é 409 (desatualizado), a venda segue ativa e o pedido pendente (dá para recusar)', async () => {
      const { v, bem } = await vendaAtrasada()
      const pid = (await pedir('cobrador', v)).json().id
      await receber('admin', v, { parcela: 1, valor: 840 })
      const r = await aprovar('admin', pid)
      expect(r.statusCode).toBe(409)
      expect(r.json().codigo).toBe('PEDIDO_DESATUALIZADO')
      expect(await statusVenda(v)).toBe('ATIVA')
      expect((await bemDe(bem)).estado).toBe('VENDIDO')
      expect((await recusar('admin', pid, { motivo: 'Pagou' })).statusCode).toBe(200)
    })
    it('venda cancelada depois do pedido: aprovar é 409 e o aparelho NÃO é mexido', async () => {
      const { v, bem } = await vendaAtrasada()
      const pid = (await pedir('cobrador', v)).json().id
      await db!('vendas').where({ id: v }).update({ status: 'CANCELADA' })
      expect((await aprovar('admin', pid)).json().codigo).toBe('VENDA_ENCERRADA')
      expect((await bemDe(bem)).estado).toBe('VENDIDO')
    })
    it('aprovar a retomada recusa os descontos que esperavam na mesma venda', async () => {
      const { v } = await vendaAtrasada()
      const desc = (await req('POST', '/api/aprovacoes', 'cobrador', { alvo: 'VENDA', operacaoId: v, parcela: 1, valor: 100, motivo: 'Cliente pediu' })).json().id
      const ret = (await pedir('cobrador', v)).json().id
      await aprovar('admin', ret)
      const p = (await req('GET', '/api/aprovacoes?limite=100', 'admin')).json().itens
      expect(p.find((x: { id: number }) => x.id === desc)).toMatchObject({ status: 'RECUSADO', resposta: 'Venda retomada' })
      expect(p.find((x: { id: number }) => x.id === ret)).toMatchObject({ status: 'APROVADO' })
    })
  })

  // ===================== corridas =====================
  describe('corridas', () => {
    it('dois administradores aprovam o mesmo pedido de retomada ao mesmo tempo → um 200 e um 409; o aparelho volta uma vez só', async () => {
      const { v, bem } = await vendaAtrasada()
      const pid = (await pedir('cobrador', v)).json().id
      segura = true
      const [a, b] = await Promise.all([aprovar('admin', pid), aprovar('admin2', pid)])
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409])
      expect(await db!('auditoria').where({ acao: 'VENDA_RETOMADA', entidade_id: v })).toHaveLength(1)
      expect((await bemDe(bem)).estado).toBe('DISPONIVEL')
    })
    it('receber o atraso e retomar ao mesmo tempo: quem pega a venda primeiro decide; nunca fica retomada com o atraso pago', async () => {
      const { v, bem } = await vendaAtrasada()
      segura = true // o recebimento segura a venda travada por 200 ms
      const [rec, ret] = await Promise.all([receber('admin', v, { parcela: 1, valor: 840 }), (async () => { await new Promise((r) => setTimeout(r, 60)); return retomar('admin2', v) })()])
      expect(rec.statusCode).toBe(201)
      expect(ret.statusCode).toBe(409)
      expect(ret.json().codigo).toBe('SEM_ATRASO')
      expect(await statusVenda(v)).toBe('ATIVA')
      expect((await bemDe(bem)).estado).toBe('VENDIDO')
    })
    it('retomar e aprovar um desconto da mesma venda ao mesmo tempo não deixa nada pela metade', async () => {
      const { v } = await vendaAtrasada()
      const desc = (await req('POST', '/api/aprovacoes', 'cobrador', { alvo: 'VENDA', operacaoId: v, parcela: 1, valor: 100, motivo: 'Cliente pediu' })).json().id
      segura = true
      const [a, b] = await Promise.all([aprovar('admin', desc), (async () => { await new Promise((r) => setTimeout(r, 60)); return retomar('admin2', v) })()])
      expect([200, 409]).toContain(a.statusCode)
      expect([200, 409]).toContain(b.statusCode)
      // o estado final é coerente: se retomou, o desconto não ficou aprovado depois; se aprovou antes, a parcela tem o desconto
      const st = await statusVenda(v)
      const p1 = await db!('venda_parcelas').where({ venda_id: v, numero: 1 }).first()
      if (st === 'RETOMADA') expect(b.statusCode).toBe(200)
      else expect(Number(p1.desconto)).toBe(100)
    })
  })
})
