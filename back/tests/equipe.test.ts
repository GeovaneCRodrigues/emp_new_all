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
import { createEquipeRepository } from '../src/modules/equipe/models/repository.js'
import { createEquipeService } from '../src/modules/equipe/services/equipe.service.js'
import { createEstoqueRepository } from '../src/modules/estoque/models/repository.js'
import { createEstoqueService } from '../src/modules/estoque/services/estoque.service.js'
import { createFechamentosRepository } from '../src/modules/fechamentos/models/repository.js'
import { createFechamentosService } from '../src/modules/fechamentos/services/fechamentos.service.js'
import { createIndicadoresRepository } from '../src/modules/indicadores/models/repository.js'
import { createIndicadoresService } from '../src/modules/indicadores/services/indicadores.service.js'
import { createRecebimentosRepository } from '../src/modules/recebimentos/models/repository.js'
import { createRecebimentosService } from '../src/modules/recebimentos/services/recebimentos.service.js'
import { createVendasRepository } from '../src/modules/vendas/models/repository.js'
import { createVendasService } from '../src/modules/vendas/services/vendas.service.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()
const SENHA = 'senha-forte-123'

describe.skipIf(!db)('equipe, aprovações e fechamento do dia (Postgres de verdade)', () => {
  let app: FastifyInstance
  let hoje = '2026-10-08'
  let segura = false
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}

  const req = (metodo: 'GET' | 'POST' | 'PATCH', url: string, papel?: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  const login = (email: string, senha: string) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha } })

  /** Venda de 3.000: entrada 600, 4 parcelas de 840 (10/11, 10/12, 10/01, 10/02). */
  async function venda(clienteId = id.cA): Promise<number> {
    const [b] = await db!('bens').insert({ modelo: 'iPhone 13', gb: 128, cor: 'Preto', preco_venda: 3000, valor_compra: 2000, data_compra: '2026-09-01' }).returning('id')
    const dia = hoje; hoje = '2026-10-08'
    const r = await req('POST', '/api/vendas', 'admin', { aparelhoId: b.id, clienteId, preco: 3000, entrada: 600, parcelas: 4, diaVencimento: 10 })
    hoje = dia
    expect(r.statusCode).toBe(201)
    return r.json().id
  }
  const receber = (papel: string, vendaId: number, corpo: object) => req('POST', `/api/vendas/${vendaId}/recebimentos`, papel, { forma: 'PIX', parcela: 1, valor: 840, ...corpo })
  const pedir = (papel: string, vendaId: number, corpo: object = {}) => req('POST', '/api/aprovacoes', papel, { alvo: 'VENDA', operacaoId: vendaId, parcela: 1, valor: 100, motivo: 'Cliente pediu pra arredondar', ...corpo })
  const parcela = async (vendaId: number, n: number) => db!('venda_parcelas').where({ venda_id: vendaId, numero: n }).first()
  const statusVenda = async (vendaId: number) => (await db!('vendas').where({ id: vendaId }).first()).status as string

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    const hash = await hashSenha(SENHA)
    const [ind] = await k('indicadores').insert({ nome: 'Roberto', pct: 0.5 }).returning('id')
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
      fechamentos: createFechamentosService({ repo: createFechamentosRepository(k), auditoria: audit, hoje: () => hoje }),
      equipe: createEquipeService({ repo: createEquipeRepository(k), auditoria: audit, hoje: () => hoje }),
      limites: { vendasPorMinuto: 100_000, recebimentosPorMinuto: 100_000 },
    })
    for (const papel of ['admin', 'admin2', 'vendedor', 'cobrador', 'cobrador2', 'indicador']) t[papel] = (await login(`${papel}@t.com`, SENHA)).json().accessToken
  })

  beforeEach(() => { hoje = '2026-10-08'; segura = false })
  afterAll(async () => { await app?.close(); await db?.destroy() })

  // ======================== aprovações ========================
  describe('pedir desconto', () => {
    it('só o cobrador pede: admin (dá direto), vendedor e indicador não (403); sem login, 401', async () => {
      const v = await venda()
      for (const papel of ['admin', 'vendedor', 'indicador']) expect((await pedir(papel, v)).statusCode).toBe(403)
      expect((await req('POST', '/api/aprovacoes', undefined, { alvo: 'VENDA', operacaoId: v, parcela: 1, valor: 100, motivo: 'abc' })).statusCode).toBe(401)
    })
    it('o cobrador pede, o pedido nasce PENDENTE com tudo o que o admin precisa ver, e audita', async () => {
      const v = await venda()
      const r = await pedir('cobrador', v, { valor: 150 })
      expect(r.statusCode).toBe(201)
      expect(r.json()).toMatchObject({ tipo: 'DESCONTO', status: 'PENDENTE', alvo: 'VENDA', operacaoId: v, parcela: 1, nParcelas: 4, valor: 150, motivo: 'Cliente pediu pra arredondar', cliente: { nome: 'Ana Souza' }, aparelho: 'iPhone 13', solicitante: { nome: 'cobrador Silva' }, respondidoPor: null })
      const a = await db!('auditoria').where({ acao: 'DESCONTO_PEDIDO', entidade_id: r.json().id }).first()
      expect(a).toMatchObject({ usuario_id: id.cobrador })
    })
    it('a parcela segue aberta e sem desconto enquanto espera', async () => {
      const v = await venda()
      await pedir('cobrador', v)
      expect(Number((await parcela(v, 1)).desconto)).toBe(0)
    })
    it.each([
      ['sem venda', { operacaoId: undefined }], ['alvo inventado', { alvo: 'CARRO' }], ['sem parcela', { parcela: undefined }], ['valor zero', { valor: 0 }], ['valor negativo', { valor: -5 }], ['valor como texto', { valor: '100' }],
      ['motivo vazio', { motivo: '' }], ['motivo curto', { motivo: 'ab' }], ['motivo enorme', { motivo: 'x'.repeat(501) }], ['desconto maior que a parcela', { valor: 840.01 }],
    ])('recusa %s (400)', async (_n, mudanca) => {
      const v = await venda()
      const corpo = { alvo: 'VENDA', operacaoId: v, parcela: 1, valor: 100, motivo: 'Cliente pediu', ...mudanca } as Record<string, unknown>
      for (const k of Object.keys(corpo)) if (corpo[k] === undefined) delete corpo[k]
      expect((await req('POST', '/api/aprovacoes', 'cobrador', corpo)).statusCode).toBe(400)
    })
    it('só um pedido pendente por parcela (409); venda de outra carteira e inexistente são 404; parcela paga é 409', async () => {
      const v = await venda()
      expect((await pedir('cobrador', v)).statusCode).toBe(201)
      expect((await pedir('cobrador', v)).json().codigo).toBe('PEDIDO_JA_EXISTE')
      expect((await pedir('cobrador2', v)).statusCode).toBe(404)
      expect((await pedir('cobrador', 999999)).statusCode).toBe(404)
      expect((await pedir('cobrador', v, { parcela: 9 })).statusCode).toBe(404)
      await receber('admin', v, { parcela: 2, valor: 840 })
      expect((await pedir('cobrador', v, { parcela: 2 })).json().codigo).toBe('PARCELA_PAGA')
    })
  })

  describe('listar', () => {
    it('o admin vê todos e o cobrador só os dele; vendedor e indicador, 403', async () => {
      const a = await venda(id.cA), b = await venda(id.cB)
      await pedir('cobrador', a); await pedir('cobrador2', b)
      const adm = (await req('GET', '/api/aprovacoes?limite=100', 'admin')).json()
      expect(new Set(adm.itens.map((x: { solicitante: { nome: string } }) => x.solicitante.nome))).toEqual(new Set(['cobrador Silva', 'cobrador2 Silva']))
      const dele = (await req('GET', '/api/aprovacoes?limite=100', 'cobrador')).json()
      expect(dele.itens.every((x: { solicitante: { nome: string } }) => x.solicitante.nome === 'cobrador Silva')).toBe(true)
      for (const papel of ['vendedor', 'indicador']) expect((await req('GET', '/api/aprovacoes', papel)).statusCode).toBe(403)
    })
    it('filtra por status, conta os pendentes, e recusa status inventado', async () => {
      const r = (await req('GET', '/api/aprovacoes?status=PENDENTE&limite=100', 'admin')).json()
      expect(r.itens.every((x: { status: string }) => x.status === 'PENDENTE')).toBe(true)
      expect(r.pendentes).toBeGreaterThan(0)
      expect((await req('GET', '/api/aprovacoes?status=XYZ', 'admin')).statusCode).toBe(400)
    })
  })

  describe('aprovar', () => {
    it('só o admin responde (403 para os outros)', async () => {
      const v = await venda()
      const p = (await pedir('cobrador', v)).json().id
      for (const papel of ['cobrador', 'vendedor', 'indicador']) {
        expect((await req('POST', `/api/aprovacoes/${p}/aprovar`, papel)).statusCode).toBe(403)
        expect((await req('POST', `/api/aprovacoes/${p}/recusar`, papel, {})).statusCode).toBe(403)
      }
    })
    it('aprovar aplica o desconto na parcela, registra quem respondeu e audita', async () => {
      const v = await venda()
      const p = (await pedir('cobrador', v, { valor: 100 })).json().id
      const r = await req('POST', `/api/aprovacoes/${p}/aprovar`, 'admin')
      expect(r.statusCode).toBe(200)
      expect(r.json()).toMatchObject({ status: 'APROVADO', respondidoPor: 'admin Silva' })
      const pa = await parcela(v, 1)
      expect(Number(pa.desconto)).toBe(100)
      expect(pa.quitada_em).toBeNull() // ainda falta 740
      const f = (await req('GET', `/api/vendas/${v}`, 'admin')).json()
      expect(f.parcelas[0]).toMatchObject({ desconto: 100, falta: 740 })
      expect(await db!('auditoria').where({ acao: 'DESCONTO_CONCEDIDO', entidade_id: v })).toHaveLength(1)
      expect(await db!('auditoria').where({ acao: 'APROVACAO_APROVADA', entidade_id: p })).toHaveLength(1)
    })
    it('desconto que cobre o resto quita a parcela, e quitar tudo fecha a venda', async () => {
      const v = await venda()
      const p = (await pedir('cobrador', v, { valor: 840 })).json().id
      await req('POST', `/api/aprovacoes/${p}/aprovar`, 'admin')
      expect((await parcela(v, 1)).quitada_em).not.toBeNull()
      for (const n of [2, 3, 4]) await db!('venda_parcelas').where({ venda_id: v, numero: n }).update({ desconto: 840, quitada_em: '2026-10-08' })
      const p2 = await db!('venda_parcelas').where({ venda_id: v, numero: 2 }).first()
      expect(Number(p2.desconto)).toBe(840)
      // a venda só fecha quando a ÚLTIMA parcela aberta é quitada por aprovação
      await db!('venda_parcelas').where({ venda_id: v, numero: 4 }).update({ desconto: 0, quitada_em: null })
      const p4 = (await pedir('cobrador', v, { parcela: 4, valor: 840 })).json().id
      await req('POST', `/api/aprovacoes/${p4}/aprovar`, 'admin')
      expect(await statusVenda(v)).toBe('QUITADA')
    })
    it('responder de novo é 409; recusar um já aprovado é 409; inexistente 404; id inválido 400', async () => {
      const v = await venda()
      const p = (await pedir('cobrador', v)).json().id
      await req('POST', `/api/aprovacoes/${p}/aprovar`, 'admin')
      expect((await req('POST', `/api/aprovacoes/${p}/aprovar`, 'admin')).json().codigo).toBe('PEDIDO_JA_RESPONDIDO')
      expect((await req('POST', `/api/aprovacoes/${p}/recusar`, 'admin', {})).json().codigo).toBe('PEDIDO_JA_RESPONDIDO')
      expect((await req('POST', '/api/aprovacoes/999999/aprovar', 'admin')).statusCode).toBe(404)
      expect((await req('POST', '/api/aprovacoes/abc/aprovar', 'admin')).statusCode).toBe(400)
    })
    it('a parcela mudou depois do pedido: aprovar é 409 e o pedido continua pendente (dá para recusar)', async () => {
      const v = await venda()
      const p = (await pedir('cobrador', v, { valor: 700 })).json().id
      await receber('admin', v, { parcela: 1, valor: 500, resto: 'FICA', novoVencimento: '2026-11-10' }) // agora faltam 340 < 700
      const r = await req('POST', `/api/aprovacoes/${p}/aprovar`, 'admin')
      expect(r.statusCode).toBe(409)
      expect(r.json().codigo).toBe('PEDIDO_DESATUALIZADO')
      expect(Number((await parcela(v, 1)).desconto)).toBe(0)
      expect((await req('POST', `/api/aprovacoes/${p}/recusar`, 'admin', { motivo: 'Mudou' })).statusCode).toBe(200)
    })
    it('recusar guarda o motivo e NÃO mexe na parcela', async () => {
      const v = await venda()
      const p = (await pedir('cobrador', v)).json().id
      const r = await req('POST', `/api/aprovacoes/${p}/recusar`, 'admin', { motivo: 'Não dá, margem apertada' })
      expect(r.json()).toMatchObject({ status: 'RECUSADO', resposta: 'Não dá, margem apertada', respondidoPor: 'admin Silva' })
      expect(Number((await parcela(v, 1)).desconto)).toBe(0)
      expect((await pedir('cobrador', v)).statusCode).toBe(201) // depois de respondido, pode pedir de novo
    })
    it('CORRIDA: dois admins aprovam o mesmo pedido ao mesmo tempo → um passa (200) e o outro é 409; o desconto entra uma vez só', async () => {
      const v = await venda()
      const p = (await pedir('cobrador', v, { valor: 200 })).json().id
      segura = true
      const [a, b] = await Promise.all([req('POST', `/api/aprovacoes/${p}/aprovar`, 'admin'), req('POST', `/api/aprovacoes/${p}/aprovar`, 'admin2')])
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409])
      expect(Number((await parcela(v, 1)).desconto)).toBe(200)
    })
    it('CORRIDA: aprovar o desconto e receber a mesma parcela ao mesmo tempo nunca deixa a parcela com saldo negativo', async () => {
      const v = await venda()
      const p = (await pedir('cobrador', v, { valor: 400 })).json().id
      segura = true
      const [a, b] = await Promise.all([req('POST', `/api/aprovacoes/${p}/aprovar`, 'admin'), receber('admin', v, { parcela: 1, valor: 800, resto: 'FICA', novoVencimento: '2026-11-10' })])
      const f = (await req('GET', `/api/vendas/${v}`, 'admin')).json().parcelas[0]
      expect(f.falta).toBeGreaterThanOrEqual(0)
      expect(f.pago + f.desconto).toBeLessThanOrEqual(840 + 0.001)
      expect([a.statusCode, b.statusCode].every((c) => [200, 201, 400, 409].includes(c))).toBe(true)
    })
  })

  describe('pedir desconto ao receber', () => {
    it('o cobrador recebe parte e pede desconto do resto: o pagamento é lançado, a parcela fica aberta e nasce o pedido', async () => {
      const v = await venda()
      const r = await receber('cobrador', v, { valor: 540, resto: 'FICA', novoVencimento: '2026-10-15', pedirDesconto: { motivo: 'Cliente só tinha 540' } })
      expect(r.statusCode).toBe(201)
      const { pedidoDescontoId, efeitos, recibo } = r.json()
      expect(efeitos).toEqual([{ tipo: 'FICA', numero: 1, resta: 300, vencimento: '2026-10-15' }])
      expect(recibo.valor).toBe(540)
      const ped = (await req('GET', '/api/aprovacoes?status=PENDENTE&limite=100', 'admin')).json().itens.find((x: { id: number }) => x.id === pedidoDescontoId)
      expect(ped).toMatchObject({ valor: 300, motivo: 'Cliente só tinha 540', alvo: 'VENDA', operacaoId: v, parcela: 1, solicitante: { nome: 'cobrador Silva' } })
      // o admin aprova: o resto (300) vira desconto e a parcela quita
      await req('POST', `/api/aprovacoes/${pedidoDescontoId}/aprovar`, 'admin')
      const f = (await req('GET', `/api/vendas/${v}`, 'admin')).json().parcelas[0]
      expect(f).toMatchObject({ pago: 540, desconto: 300, falta: 0 })
    })
    it('o cobrador só pede desconto deixando o resto "fica devendo"; desconto direto é 403; o admin não "pede"', async () => {
      const v = await venda()
      expect((await receber('cobrador', v, { valor: 540, resto: 'DESCONTO' })).statusCode).toBe(403)
      expect((await receber('cobrador', v, { valor: 540, pedirDesconto: { motivo: 'abc' } })).statusCode).toBe(400) // sem resto FICA
      expect((await receber('admin', v, { valor: 540, resto: 'FICA', novoVencimento: '2026-10-15', pedirDesconto: { motivo: 'abc' } })).statusCode).toBe(403)
      expect((await receber('cobrador', v, { valor: 540, resto: 'FICA', novoVencimento: '2026-10-15', pedirDesconto: { motivo: 'a' } })).statusCode).toBe(400) // motivo curto
    })
    it('pagou tudo: não há resto para pedir desconto (400)', async () => {
      const v = await venda()
      expect((await receber('cobrador', v, { valor: 840, resto: 'FICA', pedirDesconto: { motivo: 'sem sentido' } })).statusCode).toBe(400)
    })
    it('já existe pedido pendente na parcela: 409 e o recebimento NÃO é lançado (tudo ou nada)', async () => {
      const v = await venda()
      await pedir('cobrador', v)
      const antes = Number((await db!('transacoes_recebimento').count<{ count: string }[]>({ count: '*' }))[0].count)
      const r = await receber('cobrador', v, { valor: 540, resto: 'FICA', novoVencimento: '2026-10-15', pedirDesconto: { motivo: 'outro pedido' } })
      expect(r.statusCode).toBe(409)
      expect(Number((await db!('transacoes_recebimento').count<{ count: string }[]>({ count: '*' }))[0].count)).toBe(antes)
    })
  })

  // ======================== fechamento do dia ========================
  describe('caixa do dia e fechamento', () => {
    let dia: number
    beforeEach(() => { dia = 0 })
    const novoDia = () => { dia += 1; hoje = `2027-03-${String(10 + dia).padStart(2, '0')}` }

    it('só o cobrador tem caixa e fecha o dia (403 para os outros)', async () => {
      for (const papel of ['admin', 'vendedor', 'indicador']) {
        expect((await req('GET', '/api/caixa/hoje', papel)).statusCode).toBe(403)
        expect((await req('POST', '/api/fechamentos', papel)).statusCode).toBe(403)
      }
    })
    it('o caixa soma o que ele recebeu hoje, por forma, e lista os recebimentos (sem os desfeitos)', async () => {
      novoDia()
      const a = await venda(id.cA), b = await venda(id.cA), c = await venda(id.cA)
      hoje = '2027-03-11'
      await receber('cobrador', a, { valor: 840, forma: 'DINHEIRO' })
      await receber('cobrador', b, { valor: 840, forma: 'PIX' })
      const feito = (await receber('cobrador', c, { valor: 500, forma: 'CARTAO', resto: 'FICA', novoVencimento: '2027-03-20' })).json().recibo.id
      await receber('admin', a, { parcela: 2, valor: 840, forma: 'DINHEIRO' }) // do admin: não conta no caixa do cobrador
      let caixa = (await req('GET', '/api/caixa/hoje', 'cobrador')).json()
      expect(caixa).toMatchObject({ data: '2027-03-11', dinheiro: 840, pix: 840, cartao: 500, total: 2180, fechamento: null })
      expect(caixa.recebimentos).toHaveLength(3)
      await req('POST', `/api/recebimentos/${feito}/desfazer`, 'cobrador')
      caixa = (await req('GET', '/api/caixa/hoje', 'cobrador')).json()
      expect(caixa).toMatchObject({ cartao: 0, total: 1680 })
      expect(caixa.recebimentos).toHaveLength(2)
    })
    it('fechar: o servidor soma sozinho (ignora o que a tela mandar), uma vez por dia', async () => {
      hoje = '2027-03-12'
      const v = await venda(id.cA)
      await receber('cobrador', v, { valor: 840, forma: 'DINHEIRO' })
      const r = await req('POST', '/api/fechamentos', 'cobrador', { totalDinheiro: 999999, total: 1 })
      expect(r.statusCode).toBe(201)
      expect(r.json()).toMatchObject({ data: '2027-03-12', totalDinheiro: 840, totalPix: 0, totalCartao: 0, total: 840, status: 'PENDENTE', usuario: { nome: 'cobrador Silva' } })
      const outra = await req('POST', '/api/fechamentos', 'cobrador')
      expect(outra.statusCode).toBe(409)
      expect(outra.json().codigo).toBe('DIA_JA_FECHADO')
      expect(await db!('auditoria').where({ acao: 'DIA_FECHADO' })).not.toHaveLength(0)
    })
    it('depois de fechar, o cobrador não recebe nem desfaz naquele dia; o admin ainda recebe, mas não desfaz o recebimento do dia fechado', async () => {
      hoje = '2027-03-13'
      const v = await venda(id.cA)
      const rec = (await receber('cobrador', v, { valor: 840, parcela: 1 })).json().recibo.id
      await req('POST', '/api/fechamentos', 'cobrador')
      expect((await receber('cobrador', v, { valor: 840, parcela: 2 })).json().codigo).toBe('DIA_FECHADO')
      expect((await req('POST', `/api/recebimentos/${rec}/desfazer`, 'cobrador')).json().codigo).toBe('DIA_FECHADO')
      expect((await req('POST', `/api/recebimentos/${rec}/desfazer`, 'admin')).json().codigo).toBe('DIA_FECHADO')
      expect((await receber('admin', v, { valor: 840, parcela: 2 })).statusCode).toBe(201)
      hoje = '2027-03-14' // outro dia: o cobrador volta a receber
      expect((await receber('cobrador', v, { valor: 840, parcela: 3 })).statusCode).toBe(201)
    })
    it('o admin vê os fechamentos (pendentes primeiro, com contagem); o cobrador só os dele; confere uma vez', async () => {
      hoje = '2027-03-15'
      const a = await venda(id.cA), b = await venda(id.cB)
      await receber('cobrador', a, { valor: 840, forma: 'PIX' }); await receber('cobrador2', b, { valor: 840, forma: 'DINHEIRO' })
      await req('POST', '/api/fechamentos', 'cobrador'); await req('POST', '/api/fechamentos', 'cobrador2')
      const adm = (await req('GET', '/api/fechamentos?status=PENDENTE&limite=100', 'admin')).json()
      expect(adm.pendentes).toBeGreaterThanOrEqual(2)
      const dele = (await req('GET', '/api/fechamentos?limite=100', 'cobrador')).json()
      expect(dele.itens.every((x: { usuario: { nome: string } }) => x.usuario.nome === 'cobrador Silva')).toBe(true)
      const alvo = adm.itens.find((x: { usuario: { nome: string }; data: string }) => x.usuario.nome === 'cobrador Silva' && x.data === '2027-03-15')
      const ok = await req('POST', `/api/fechamentos/${alvo.id}/conferir`, 'admin')
      expect(ok.json()).toMatchObject({ status: 'CONFERIDO', conferidoPor: 'admin Silva' })
      expect((await req('POST', `/api/fechamentos/${alvo.id}/conferir`, 'admin')).json().codigo).toBe('JA_CONFERIDO')
      for (const papel of ['cobrador', 'vendedor', 'indicador']) expect((await req('POST', `/api/fechamentos/${alvo.id}/conferir`, papel)).statusCode).toBe(403)
      expect((await req('GET', '/api/fechamentos', 'vendedor')).statusCode).toBe(403)
    })
    it('reabrir (só pendente): o cobrador volta a lançar e fecha de novo com os totais novos; conferido não reabre', async () => {
      hoje = '2027-03-16'
      const v = await venda(id.cA)
      await receber('cobrador', v, { valor: 840, parcela: 1, forma: 'PIX' })
      const f = (await req('POST', '/api/fechamentos', 'cobrador')).json()
      expect((await req('POST', `/api/fechamentos/${f.id}/reabrir`, 'cobrador')).statusCode).toBe(403)
      expect((await req('POST', `/api/fechamentos/${f.id}/reabrir`, 'admin')).statusCode).toBe(204)
      await receber('cobrador', v, { valor: 840, parcela: 2, forma: 'DINHEIRO' })
      const novo = (await req('POST', '/api/fechamentos', 'cobrador')).json()
      expect(novo).toMatchObject({ totalPix: 840, totalDinheiro: 840, total: 1680 })
      await req('POST', `/api/fechamentos/${novo.id}/conferir`, 'admin')
      expect((await req('POST', `/api/fechamentos/${novo.id}/reabrir`, 'admin')).json().codigo).toBe('JA_CONFERIDO')
      expect((await req('POST', '/api/fechamentos/999999/conferir', 'admin')).statusCode).toBe(404)
    })
    it('CORRIDA: fechar o dia enquanto um recebimento está sendo lançado: o fechamento espera e SOMA o recebimento', async () => {
      hoje = '2027-03-17'
      const v = await venda(id.cA)
      segura = true // o recebimento fica 200 ms "no meio" da transação, já com o caixa travado
      const recebendo = receber('cobrador', v, { valor: 840, forma: 'DINHEIRO' })
      await new Promise((r) => setTimeout(r, 60))
      const fechando = req('POST', '/api/fechamentos', 'cobrador')
      const [r, f] = await Promise.all([recebendo, fechando])
      expect(r.statusCode).toBe(201)
      expect(f.statusCode).toBe(201)
      expect(f.json().totalDinheiro).toBe(840) // sem a trava, o fechamento somaria 0 e o dinheiro ficaria de fora
    })
  })

  // ======================== equipe ========================
  describe('equipe', () => {
    it('só o admin vê e gerencia a equipe (403 para os outros)', async () => {
      for (const papel of ['vendedor', 'cobrador', 'indicador']) {
        expect((await req('GET', '/api/equipe', papel)).statusCode).toBe(403)
        expect((await req('POST', '/api/equipe', papel, { nome: 'Fulano', email: 'f@t.com', perfil: 'VENDEDOR' })).statusCode).toBe(403)
        expect((await req('PATCH', `/api/equipe/${id.vendedor}`, papel, { ativo: false })).statusCode).toBe(403)
      }
      expect((await req('GET', '/api/equipe')).statusCode).toBe(401)
    })
    it('lista as pessoas com carteira, atrasos, recebido no mês e pedidos pendentes', async () => {
      hoje = '2026-11-20' // a 1ª parcela das vendas (10/11) já venceu
      const v = await venda(id.cA)
      await receber('cobrador2', await venda(id.cB), { valor: 840 }) // 840 recebidos em novembro pelo outro cobrador
      await pedir('cobrador', v)
      const lista = (await req('GET', '/api/equipe', 'admin')).json() as { nome: string; perfil: string; carteira: number; comAtraso: number; recebidoNoMes: number; pedidosPendentes: number; vendasNoMes: number }[]
      expect(lista.map((p) => p.perfil)).toEqual([...lista.map((p) => p.perfil)].sort((a, b) => ['ADMIN', 'COBRADOR', 'VENDEDOR'].indexOf(a) - ['ADMIN', 'COBRADOR', 'VENDEDOR'].indexOf(b)))
      expect(lista.some((p) => p.perfil === 'INDICADOR')).toBe(false)
      const cobrador = lista.find((p) => p.nome === 'cobrador Silva')!
      expect(cobrador).toMatchObject({ carteira: 1, comAtraso: 1 })
      expect(cobrador.pedidosPendentes).toBeGreaterThanOrEqual(1)
      const outro = lista.find((p) => p.nome === 'cobrador2 Silva')!
      expect(outro.recebidoNoMes).toBe(840) // só o recebimento de novembro; os de outros meses não entram
      expect(lista.find((p) => p.nome === 'admin Silva')!.vendasNoMes).toBe(0) // as vendas dos testes são de outubro
    })

    describe('convidar', () => {
      it('cria o acesso com senha temporária mostrada uma vez; o convidado entra e é obrigado a trocar a senha', async () => {
        const r = await req('POST', '/api/equipe', 'admin', { nome: '  Bruna   Teixeira ', email: 'Bruna@Loja.com', perfil: 'VENDEDOR', fone: '(11) 98123-4455' })
        expect(r.statusCode).toBe(201)
        expect(r.headers['cache-control']).toBe('no-store')
        const { id: novoId, email, senhaTemporaria } = r.json()
        expect(email).toBe('bruna@loja.com')
        expect(senhaTemporaria.length).toBeGreaterThanOrEqual(10)
        const u = await db!('users').where({ id: novoId }).first()
        expect(u).toMatchObject({ nome: 'Bruna Teixeira', perfil: 'VENDEDOR', fone: '11981234455', ativo: true, senha_temporaria: true })
        expect(u.senha_hash).not.toContain(senhaTemporaria)
        expect(JSON.stringify(await db!('auditoria').where({ acao: 'EQUIPE_CONVIDADO', entidade_id: novoId }).first())).not.toContain(senhaTemporaria)
        const l = await login('bruna@loja.com', senhaTemporaria)
        expect(l.statusCode).toBe(200)
        expect(l.json().usuario).toMatchObject({ perfil: 'VENDEDOR', precisaTrocarSenha: true })
        const bloqueado = await app.inject({ method: 'GET', url: '/api/aparelhos', headers: { authorization: `Bearer ${l.json().accessToken}` } })
        expect(bloqueado.json().codigo).toBe('TROCAR_SENHA')
        id.bruna = novoId
      })
      it('e-mail repetido é 409; perfil de admin/indicador é recusado; dados inválidos são 400', async () => {
        expect((await req('POST', '/api/equipe', 'admin', { nome: 'Outra', email: 'bruna@loja.com', perfil: 'COBRADOR' })).json().codigo).toBe('EMAIL_EM_USO')
        for (const perfil of ['ADMIN', 'INDICADOR', 'DONO', undefined]) expect((await req('POST', '/api/equipe', 'admin', { nome: 'Fulano', email: `f${perfil}@t.com`, perfil })).statusCode).toBe(400)
        expect((await req('POST', '/api/equipe', 'admin', { nome: 'F', email: 'f1@t.com', perfil: 'COBRADOR' })).statusCode).toBe(400)
        expect((await req('POST', '/api/equipe', 'admin', { nome: 'Fulano', email: 'nao-e-email', perfil: 'COBRADOR' })).statusCode).toBe(400)
        expect((await req('POST', '/api/equipe', 'admin', { nome: 'Fulano', email: 'f2@t.com', perfil: 'COBRADOR', fone: '123' })).statusCode).toBe(400)
      })
    })

    describe('alterar e desativar', () => {
      it('edita nome e telefone; audita o antes e o depois', async () => {
        const r = await req('PATCH', `/api/equipe/${id.bruna}`, 'admin', { nome: 'Bruna T. Souza', fone: '(11) 90000-0000' })
        expect(r.statusCode).toBe(200)
        expect(r.json()).toMatchObject({ nome: 'Bruna T. Souza' })
        const a = await db!('auditoria').where({ acao: 'EQUIPE_ALTERADO', entidade_id: id.bruna }).first()
        expect(a.antes.nome).toBe('Bruna Teixeira')
        expect(a.depois.nome).toBe('Bruna T. Souza')
      })
      it('desativar derruba o acesso na hora (sessão e login); reativar devolve', async () => {
        const [u] = await db!('users').where({ id: id.cobrador2 })
        expect(u.ativo).toBe(true)
        expect((await req('GET', '/api/auth/eu', 'cobrador2')).statusCode).toBe(200)
        const antigo = t.cobrador2
        const off = await req('PATCH', `/api/equipe/${id.cobrador2}`, 'admin', { ativo: false })
        expect(off.json().ativo).toBe(false)
        expect((await req('GET', '/api/auth/eu', 'cobrador2')).statusCode).toBe(401)
        expect((await login('cobrador2@t.com', SENHA)).statusCode).toBe(401)
        expect((await req('PATCH', `/api/equipe/${id.cobrador2}`, 'admin', { ativo: true })).json().ativo).toBe(true)
        // reativar NÃO ressuscita a sessão de antes: ela foi revogada na hora de desativar
        expect((await app.inject({ method: 'GET', url: '/api/auth/eu', headers: { authorization: `Bearer ${antigo}` } })).statusCode).toBe(401)
        t.cobrador2 = (await login('cobrador2@t.com', SENHA)).json().accessToken
        expect((await req('GET', '/api/auth/eu', 'cobrador2')).statusCode).toBe(200)
      })
      it('não desativa a si mesmo, não mexe em administrador, 404 e validações', async () => {
        expect((await req('PATCH', `/api/equipe/${id.admin}`, 'admin', { ativo: false })).statusCode).toBe(403) // admin não se altera por aqui
        expect((await req('PATCH', `/api/equipe/${id.admin2}`, 'admin', { nome: 'X Y' })).statusCode).toBe(403)
        expect((await req('PATCH', '/api/equipe/999999', 'admin', { ativo: false })).statusCode).toBe(404)
        expect((await req('PATCH', `/api/equipe/${id.bruna}`, 'admin', { ativo: 'nao' })).statusCode).toBe(400)
        expect((await req('PATCH', `/api/equipe/${id.bruna}`, 'admin', { nome: ' ' })).statusCode).toBe(400)
        expect((await req('PATCH', `/api/equipe/${id.bruna}`, 'admin', { fone: 'abc' })).statusCode).toBe(400)
        expect((await req('PATCH', '/api/equipe/abc', 'admin', {})).statusCode).toBe(400)
      })
    })
  })
})
