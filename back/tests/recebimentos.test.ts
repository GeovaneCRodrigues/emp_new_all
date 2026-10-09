import type { FastifyInstance } from 'fastify'
import type { Knex } from 'knex'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
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

describe.skipIf(!db)('recebimentos (Postgres de verdade)', () => {
  let app: FastifyInstance
  let hoje = '2026-10-08'
  /** Liga o "segura a transação" só nos testes de corrida. */
  let seguraTransacao = false
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}

  const req = (metodo: 'GET' | 'POST', url: string, papel?: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })

  /**
   * Venda de 3.000: entrada 600, 4 parcelas de 840 (2.400 × 1,4 ÷ 4), vencendo dia 10 a partir de novembro
   * (10/11, 10/12, 10/01, 10/02). O total a receber depois da entrada é 3.360.
   */
  async function venda(clienteId = id.cA, extra: object = {}): Promise<number> {
    const [b] = await db!('bens').insert({ modelo: 'iPhone 13', gb: 128, cor: 'Preto', preco_venda: 3000, valor_compra: 2000, data_compra: '2026-09-01' }).returning('id')
    const dia = hoje
    hoje = '2026-10-08'
    const r = await req('POST', '/api/vendas', 'admin', { aparelhoId: b.id, clienteId, preco: 3000, entrada: 600, parcelas: 4, diaVencimento: 10, ...extra })
    hoje = dia
    expect(r.statusCode).toBe(201)
    return r.json().id
  }
  const receber = (papel: string, vendaId: number, corpo: object) => req('POST', `/api/vendas/${vendaId}/recebimentos`, papel, { forma: 'PIX', ...corpo })
  const parcelas = async (vendaId: number) => (await db!('venda_parcelas').where({ venda_id: vendaId }).orderBy('numero')).map((p: Record<string, unknown>) => ({
    numero: p.numero as number, vencimento: String(p.vencimento instanceof Date ? p.vencimento.toISOString() : p.vencimento).slice(0, 10), original: p.vencimento_original ? String(p.vencimento_original instanceof Date ? p.vencimento_original.toISOString() : p.vencimento_original).slice(0, 10) : null,
    desconto: Number(p.desconto), quitada: p.quitada_em ? String(p.quitada_em instanceof Date ? p.quitada_em.toISOString() : p.quitada_em).slice(0, 10) : null,
  }))
  const statusVenda = async (vendaId: number) => (await db!('vendas').where({ id: vendaId }).first()).status as string

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    await k('sistema_config').where({ chave: 'empresa_nome' }).update({ valor: JSON.stringify('Mundo dos iPhones') })
    const hash = await hashSenha(SENHA)
    const [ind] = await k('indicadores').insert({ nome: 'Roberto', pct: 0.5 }).returning('id')
    for (const [chave, perfil, extra] of [['admin', 'ADMIN', {}], ['vendedor', 'VENDEDOR', {}], ['cobrador', 'COBRADOR', {}], ['cobrador2', 'COBRADOR', {}], ['indicador', 'INDICADOR', { indicador_id: ind.id }]] as const) {
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
    app = await buildApp({
      env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, clientes: {} as never, usuarios: {} as never, indicadores,
      estoque: createEstoqueService(createEstoqueRepository(k), audit), config: createConfigService(config),
      vendas: createVendasService({ vendas: createVendasRepository(k), config, auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis(), hoje: () => hoje }),
      recebimentos: createRecebimentosService({ repo: createRecebimentosRepository(k), auditoria: audit, hoje: () => hoje, depoisDeLerParcelas: async () => { if (seguraTransacao) await new Promise((r) => setTimeout(r, 150)) } }),
      aprovacoes: {} as never, fechamentos: {} as never, equipe: {} as never,
      limites: { vendasPorMinuto: 100_000, recebimentosPorMinuto: 100_000 },
    })
    for (const papel of ['admin', 'vendedor', 'cobrador', 'cobrador2', 'indicador'])
      t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  })

  beforeEach(() => { hoje = '2026-10-08'; seguraTransacao = false })
  afterAll(async () => {
    await db?.('sistema_config').where({ chave: 'empresa_nome' }).update({ valor: JSON.stringify('Mundo dos iPhones') })
    await app?.close()
    await db?.destroy()
  })

  describe('permissões', () => {
    it('vendedor e indicador não mexem com recebimentos (403); sem login, 401', async () => {
      const v = await venda()
      for (const papel of ['vendedor', 'indicador']) {
        expect((await receber(papel, v, { parcela: 1, valor: 840 })).statusCode).toBe(403)
        expect((await req('GET', `/api/vendas/${v}/pagamentos`, papel)).statusCode).toBe(403)
        expect((await req('GET', '/api/recibos/1', papel)).statusCode).toBe(403)
        // a lista de cobranças: o vendedor não vê; o indicador vê só a das operações dele (indicador-leitura.test.ts)
        expect((await req('GET', '/api/cobrancas', papel)).statusCode).toBe(papel === 'indicador' ? 200 : 403)
        expect((await req('POST', '/api/recebimentos/1/desfazer', papel)).statusCode).toBe(403)
      }
      expect((await req('POST', `/api/vendas/${v}/recebimentos`, undefined, { parcela: 1, valor: 840, forma: 'PIX' })).statusCode).toBe(401)
    })
    it('cobrador só mexe na venda de cliente da carteira dele (404 nas outras)', async () => {
      const deB = await venda(id.cB)
      expect((await receber('cobrador', deB, { parcela: 1, valor: 840 })).statusCode).toBe(404)
      expect((await req('GET', `/api/vendas/${deB}/pagamentos`, 'cobrador')).statusCode).toBe(404)
      expect((await receber('cobrador2', deB, { parcela: 1, valor: 840 })).statusCode).toBe(201)
    })
  })

  describe('pagou o valor certo', () => {
    it('quita a parcela e devolve o recibo, com o texto do WhatsApp', async () => {
      const v = await venda()
      hoje = '2026-11-10'
      const r = await receber('admin', v, { parcela: 1, valor: 840, forma: 'PIX' })
      expect(r.statusCode).toBe(201)
      const { recibo, efeitos, quitada: vendaQuitada } = r.json()
      expect(efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }])
      expect(vendaQuitada).toBe(false)
      expect(recibo).toMatchObject({ valor: 840, forma: 'PIX', data: '2026-11-10', referencia: 'parcela 1/4', faltaDepois: 2520, restantes: 3, desfeita: false, aparelho: 'iPhone 13', empresa: { nome: 'Mundo dos iPhones', cnpj: null } })
      expect(recibo.numero).toMatch(/^\d{6}$/)
      expect(recibo.proxima).toEqual({ numero: 2, valor: 840, vencimento: '2026-12-10' })
      expect(recibo.recebidoPor).toBe('admin')
      expect(recibo.mensagem).toContain('Recibo nº ' + recibo.numero)
      expect(recibo.mensagem).toContain('Recebemos R$ 840,00 em 10/11/2026 (Pix), referente à parcela 1/4 do seu iPhone 13.')
      expect(recibo.mensagem).toContain('Próxima: 2ª, R$ 840,00, vence 10/12. Faltam 3 parcelas (R$ 2.520,00).')
      expect((await parcelas(v))[0]).toMatchObject({ quitada: '2026-11-10' })
    })
    it('quitar a última parcela fecha a venda; pagar de novo é 409', async () => {
      const v = await venda()
      const r = await receber('admin', v, { parcela: 1, valor: 3360 })
      expect(r.statusCode).toBe(201)
      expect(r.json()).toMatchObject({ quitada: true })
      expect(r.json().recibo.mensagem).toContain('Tudo quitado! Obrigado pela confiança.')
      expect(r.json().recibo.proxima).toBeNull()
      expect(await statusVenda(v)).toBe('QUITADA')
      expect((await receber('admin', v, { parcela: 4, valor: 10 })).json().codigo).toBe('PARCELA_PAGA')
    })
  })

  describe('pagou menos', () => {
    it('fica devendo com nova data: parcela com o resto, vencimento novo, o antigo guardado, sai dos atrasados', async () => {
      const v = await venda()
      hoje = '2026-11-20' // a 1ª venceu em 10/11
      const antes = (await req('GET', `/api/vendas/${v}`, 'admin')).json()
      expect(antes.atrasadas).toBe(1)
      const r = await receber('admin', v, { parcela: 1, valor: 100, resto: 'FICA', novoVencimento: '2026-11-27' })
      expect(r.statusCode).toBe(201)
      expect(r.json().efeitos).toEqual([{ tipo: 'FICA', numero: 1, resta: 740, vencimento: '2026-11-27' }])
      expect(r.json().recibo.ficaDevendo).toEqual({ numero: 1, valor: 740, vencimento: '2026-11-27' })
      expect(r.json().recibo.mensagem).toContain('Na 1ª ainda ficam R$ 740,00, para 27/11.')
      const f = (await req('GET', `/api/vendas/${v}`, 'admin')).json()
      expect(f.parcelas[0]).toMatchObject({ vencimento: '2026-11-27', vencimentoOriginal: '2026-11-10', pago: 100, falta: 740 })
      expect(f.atrasadas).toBe(0)
      expect(f.parcelas[1].vencimento).toBe('2026-12-10') // as próximas ficam nas datas delas
      expect(await statusVenda(v)).toBe('ATIVA')
    })
    it('sem dizer o que fazer com o resto, recusa; data nova no passado, recusa', async () => {
      const v = await venda()
      const sem = await receber('admin', v, { parcela: 1, valor: 100 })
      expect(sem.statusCode).toBe(400)
      expect(sem.json().codigo).toBe('RESTO_OBRIGATORIO')
      expect((await receber('admin', v, { parcela: 1, valor: 100, resto: 'FICA', novoVencimento: '2026-10-01' })).json().codigo).toBe('VENCIMENTO_INVALIDO')
      expect(await db!('recebimentos').where({ tipo: 'PARCELA' }).whereIn('venda_parcela_id', db!('venda_parcelas').where({ venda_id: v }).select('id'))).toHaveLength(0)
    })
    it('desconto (admin): quita a parcela e o desconto fica registrado', async () => {
      const v = await venda()
      const r = await receber('admin', v, { parcela: 1, valor: 100, resto: 'DESCONTO' })
      expect(r.json().efeitos).toEqual([{ tipo: 'DESCONTO', numero: 1, valor: 740 }])
      expect((await parcelas(v))[0]).toMatchObject({ desconto: 740, quitada: '2026-10-08' })
      expect((await req('GET', `/api/vendas/${v}`, 'admin')).json().parcelas[0]).toMatchObject({ falta: 0, desconto: 740 })
      expect(await db!('auditoria').where({ acao: 'DESCONTO_CONCEDIDO', entidade_id: v })).toHaveLength(1)
    })
    it('o cobrador não dá desconto (403): precisa da aprovação do administrador', async () => {
      const v = await venda()
      const r = await receber('cobrador', v, { parcela: 1, valor: 100, resto: 'DESCONTO' })
      expect(r.statusCode).toBe(403)
      expect(r.json().erro).toMatch(/aprovação/)
    })
    it('mudança de vencimento vai para a auditoria com o antes e o depois', async () => {
      const v = await venda()
      hoje = '2026-11-20'
      await receber('admin', v, { parcela: 1, valor: 100, resto: 'FICA', novoVencimento: '2026-11-27' })
      const a = await db!('auditoria').where({ acao: 'VENCIMENTO_ALTERADO', entidade_id: v }).first()
      expect(a.antes).toEqual({ parcela: 1, vencimento: '2026-11-10' })
      expect(a.depois).toEqual({ parcela: 1, vencimento: '2026-11-27' })
    })
  })

  describe('pagou a mais', () => {
    it('quita a atual e as próximas e abate o resto da seguinte, numa transação só', async () => {
      const v = await venda()
      const r = await receber('admin', v, { parcela: 1, valor: 2000 })
      expect(r.statusCode).toBe(201)
      expect(r.json().efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }, { tipo: 'QUITA', numero: 2 }, { tipo: 'ABATE', numero: 3, valor: 320 }])
      expect(r.json().recibo).toMatchObject({ referencia: 'parcelas 1 a 3 de 4', valor: 2000, faltaDepois: 1360, restantes: 2, proxima: { numero: 3, valor: 520 } })
      const rows = await db!('recebimentos').whereIn('venda_parcela_id', db!('venda_parcelas').where({ venda_id: v }).select('id'))
      expect(rows).toHaveLength(3)
      expect(new Set(rows.map((x: { transacao_id: number }) => x.transacao_id)).size).toBe(1)
      expect(rows.map((x: { valor: string }) => Number(x.valor)).sort((a: number, b: number) => a - b)).toEqual([320, 840, 840])
    })
    it('valor acima do que falta é recusado (não vira crédito)', async () => {
      const v = await venda()
      expect((await receber('admin', v, { parcela: 1, valor: 3360.01 })).json().codigo).toBe('EXCEDE_DIVIDA')
      expect((await receber('admin', v, { parcela: 1, valor: 3360 })).statusCode).toBe(201)
    })
  })

  describe('validações', () => {
    it.each([
      ['sem parcela', { valor: 100 }], ['parcela zero', { parcela: 0, valor: 100 }], ['parcela com vírgula', { parcela: 1.5, valor: 100 }],
      ['sem valor', { parcela: 1 }], ['valor zero', { parcela: 1, valor: 0 }], ['valor negativo', { parcela: 1, valor: -5 }], ['valor como texto', { parcela: 1, valor: '840' }], ['valor absurdo', { parcela: 1, valor: 1e12 }],
      ['forma inventada', { parcela: 1, valor: 840, forma: 'FIADO' }], ['data em outro formato', { parcela: 1, valor: 840, data: '08/10/2026' }], ['data inexistente', { parcela: 1, valor: 840, data: '2026-02-31' }],
      ['data no futuro', { parcela: 1, valor: 840, data: '2026-10-09' }], ['data antes da venda', { parcela: 1, valor: 840, data: '2026-10-07' }], ['resto inventado', { parcela: 1, valor: 100, resto: 'TALVEZ' }],
    ])('recusa %s (400)', async (_n, corpo) => {
      const v = await venda()
      expect((await receber('admin', v, corpo)).statusCode).toBe(400)
    })
    it('parcela inexistente é 404, venda inexistente é 404, id inválido é 400', async () => {
      const v = await venda()
      expect((await receber('admin', v, { parcela: 9, valor: 100 })).statusCode).toBe(404)
      expect((await receber('admin', 999999, { parcela: 1, valor: 100 })).statusCode).toBe(404)
      expect((await req('POST', '/api/vendas/abc/recebimentos', 'admin', { parcela: 1, valor: 1, forma: 'PIX' })).statusCode).toBe(400)
    })
    it('o admin pode lançar uma data passada (depois da venda); o cobrador só hoje', async () => {
      const v = await venda()
      hoje = '2026-11-20'
      const antigo = await receber('admin', v, { parcela: 1, valor: 840, data: '2026-11-10' })
      expect(antigo.statusCode).toBe(201)
      expect(antigo.json().recibo.data).toBe('2026-11-10')
      const v2 = await venda()
      const r = await receber('cobrador', v2, { parcela: 1, valor: 840, data: '2026-11-10' })
      expect(r.statusCode).toBe(403)
    })
    it('venda retomada ou cancelada não recebe pagamento (409)', async () => {
      const v = await venda()
      await db!('vendas').where({ id: v }).update({ status: 'RETOMADA' })
      expect((await receber('admin', v, { parcela: 1, valor: 840 })).json().codigo).toBe('VENDA_ENCERRADA')
    })
  })

  describe('corrida', () => {
    it('dois recebimentos da mesma parcela ao mesmo tempo: um passa e o outro é recusado (não paga em dobro)', async () => {
      const v = await venda()
      seguraTransacao = true // cada transação espera 150 ms depois de ler: sem a trava, as duas leriam "aberta" e pagariam em dobro
      const [a, b] = await Promise.all([receber('admin', v, { parcela: 1, valor: 840 }), receber('cobrador', v, { parcela: 1, valor: 840 })])
      expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409])
      const feitos = await db!('recebimentos as r').join('venda_parcelas as p', 'p.id', 'r.venda_parcela_id').where('p.venda_id', v).where('p.numero', 1)
      expect(feitos).toHaveLength(1)
    })
    it('vários recebimentos parciais ao mesmo tempo nunca passam do que a parcela deve', async () => {
      const v = await venda()
      seguraTransacao = true
      const rs = await Promise.all(Array.from({ length: 6 }, () => receber('admin', v, { parcela: 1, valor: 300, resto: 'FICA', novoVencimento: '2026-10-20' })))
      const ok = rs.filter((r) => r.statusCode === 201).length
      const [{ soma }] = await db!('recebimentos as r').join('venda_parcelas as p', 'p.id', 'r.venda_parcela_id').where('p.venda_id', v).sum({ soma: 'r.valor' })
      // 300 × 6 = 1.800 > 840 da 1ª: o excedente abate as próximas, mas a venda toda só deve 3.360
      expect(Number(soma)).toBeLessThanOrEqual(3360)
      expect(Number(soma)).toBe(ok * 300)
    })
  })

  describe('desfazer', () => {
    async function duasBaixas() {
      const v = await venda()
      const a = (await receber('admin', v, { parcela: 1, valor: 840 })).json().recibo.id
      const b = (await receber('admin', v, { parcela: 2, valor: 840 })).json().recibo.id
      return { v, a, b }
    }
    it('só o último recebimento da venda se desfaz; depois, o anterior passa a ser o último', async () => {
      const { v, a, b } = await duasBaixas()
      const velho = await req('POST', `/api/recebimentos/${a}/desfazer`, 'admin')
      expect(velho.statusCode).toBe(409)
      expect(velho.json().codigo).toBe('NAO_E_O_ULTIMO')
      expect((await req('POST', `/api/recebimentos/${b}/desfazer`, 'admin')).statusCode).toBe(204)
      expect((await req('POST', `/api/recebimentos/${a}/desfazer`, 'admin')).statusCode).toBe(204)
      const f = (await req('GET', `/api/vendas/${v}`, 'admin')).json()
      expect(f.parcelas.map((p: { pago: number }) => p.pago)).toEqual([0, 0, 0, 0])
      expect((await parcelas(v)).every((p) => p.quitada === null)).toBe(true)
    })
    it('desfazer de novo é 409; recebimento inexistente é 404; a entrada não se desfaz aqui', async () => {
      const { v, b } = await duasBaixas()
      await req('POST', `/api/recebimentos/${b}/desfazer`, 'admin')
      expect((await req('POST', `/api/recebimentos/${b}/desfazer`, 'admin')).json().codigo).toBe('JA_DESFEITO')
      expect((await req('POST', '/api/recebimentos/999999/desfazer', 'admin')).statusCode).toBe(404)
      const entrada = (await req('GET', `/api/vendas/${v}/pagamentos`, 'admin')).json().find((p: { tipo: string }) => p.tipo === 'ENTRADA')
      expect((await req('POST', `/api/recebimentos/${entrada.transacaoId}/desfazer`, 'admin')).json().codigo).toBe('ENTRADA_NAO_DESFAZ')
    })
    it('volta tudo como estava: vencimento remarcado, desconto e venda quitada', async () => {
      const v = await venda()
      hoje = '2026-11-20'
      const antes = await parcelas(v)
      const parcial = (await receber('admin', v, { parcela: 1, valor: 100, resto: 'FICA', novoVencimento: '2026-11-27' })).json().recibo.id
      expect((await parcelas(v))[0]).toMatchObject({ vencimento: '2026-11-27', original: '2026-11-10' })
      await req('POST', `/api/recebimentos/${parcial}/desfazer`, 'admin')
      expect(await parcelas(v)).toEqual(antes)

      const desc = (await receber('admin', v, { parcela: 1, valor: 100, resto: 'DESCONTO' })).json().recibo.id
      expect((await parcelas(v))[0].desconto).toBe(740)
      await req('POST', `/api/recebimentos/${desc}/desfazer`, 'admin')
      expect(await parcelas(v)).toEqual(antes)

      const tudo = (await receber('admin', v, { parcela: 1, valor: 3360 })).json().recibo.id
      expect(await statusVenda(v)).toBe('QUITADA')
      await req('POST', `/api/recebimentos/${tudo}/desfazer`, 'admin')
      expect(await statusVenda(v)).toBe('ATIVA')
      expect(await parcelas(v)).toEqual(antes)
    })
    it('o recibo desfeito continua existindo, marcado como desfeito; e a auditoria registra', async () => {
      const { v, b } = await duasBaixas()
      await req('POST', `/api/recebimentos/${b}/desfazer`, 'admin')
      expect((await req('GET', `/api/recibos/${b}`, 'admin')).json().desfeita).toBe(true)
      expect(await db!('auditoria').where({ acao: 'RECEBIMENTO_DESFEITO', entidade_id: v })).toHaveLength(1)
    })
    it('o cobrador desfaz só o que ele mesmo recebeu hoje', async () => {
      const v = await venda(id.cA)
      const doAdmin = (await receber('admin', v, { parcela: 1, valor: 840 })).json().recibo.id
      expect((await req('POST', `/api/recebimentos/${doAdmin}/desfazer`, 'cobrador')).statusCode).toBe(403)
      const doCobrador = (await receber('cobrador', v, { parcela: 2, valor: 840 })).json().recibo.id
      expect((await req('POST', `/api/recebimentos/${doCobrador}/desfazer`, 'cobrador2')).statusCode).toBe(404) // outra carteira
      hoje = '2026-10-09'
      expect((await req('POST', `/api/recebimentos/${doCobrador}/desfazer`, 'cobrador')).statusCode).toBe(403) // outro dia
      hoje = '2026-10-08'
      expect((await req('POST', `/api/recebimentos/${doCobrador}/desfazer`, 'cobrador')).statusCode).toBe(204)
    })
  })

  describe('recibos e pagamentos', () => {
    it('lista os pagamentos da venda (entrada e parcelas) e diz o que dá para desfazer', async () => {
      const v = await venda(id.cA)
      await receber('admin', v, { parcela: 1, valor: 840 })
      const u = (await receber('cobrador', v, { parcela: 2, valor: 840 })).json().recibo.id
      const lista = (await req('GET', `/api/vendas/${v}/pagamentos`, 'admin')).json() as { tipo: string; transacaoId: number; podeDesfazer: boolean; referencia: string }[]
      expect(lista.map((p) => p.tipo)).toEqual(['PARCELA', 'PARCELA', 'ENTRADA'])
      expect(lista.map((p) => p.referencia)).toEqual(['parcela 2/4', 'parcela 1/4', 'entrada'])
      expect(lista.filter((p) => p.podeDesfazer).map((p) => p.transacaoId)).toEqual([u]) // só o último
      const doCobrador = (await req('GET', `/api/vendas/${v}/pagamentos`, 'cobrador')).json() as { podeDesfazer: boolean }[]
      expect(doCobrador.filter((p) => p.podeDesfazer)).toHaveLength(1) // o último foi dele, hoje
    })
    it('transação antiga, sem o retrato do recibo: a entrada continua sendo entrada e não oferece "desfazer"', async () => {
      const v = await venda()
      await db!('transacoes_recebimento').whereIn('id', db!('recebimentos').where({ venda_id: v }).select('transacao_id')).update({ resumo: null })
      await receber('admin', v, { parcela: 1, valor: 840 })
      const lista = (await req('GET', `/api/vendas/${v}/pagamentos`, 'admin')).json() as { tipo: string; referencia: string; podeDesfazer: boolean; transacaoId: number }[]
      const entrada = lista.find((p) => p.tipo === 'ENTRADA')!
      expect(entrada).toMatchObject({ referencia: 'entrada', podeDesfazer: false })
      expect(lista.filter((p) => p.podeDesfazer)).toHaveLength(1) // só a parcela
      const ultima = lista.find((p) => p.tipo === 'PARCELA')!
      await req('POST', `/api/recebimentos/${ultima.transacaoId}/desfazer`, 'admin')
      const depois = (await req('GET', `/api/vendas/${v}/pagamentos`, 'admin')).json() as { tipo: string; podeDesfazer: boolean }[]
      expect(depois.find((p) => p.tipo === 'ENTRADA')!.podeDesfazer).toBe(false) // a entrada nunca vira "o último"
      expect((await req('GET', `/api/recibos/${entrada.transacaoId}`, 'admin')).json().referencia).toBe('entrada')
    })
    it('o recibo da entrada mostra o que ficou combinado para pagar', async () => {
      const v = await venda()
      const entrada = (await req('GET', `/api/vendas/${v}/pagamentos`, 'admin')).json().find((p: { tipo: string }) => p.tipo === 'ENTRADA')
      const r = (await req('GET', `/api/recibos/${entrada.transacaoId}`, 'admin')).json()
      expect(r).toMatchObject({ valor: 600, referencia: 'entrada', faltaDepois: 3360, restantes: 4, proxima: { numero: 1, valor: 840, vencimento: '2026-11-10' } })
      expect(r.mensagem).toContain('referente à entrada do seu iPhone 13.')
    })
    it('o recibo é um retrato: pagamentos depois não mudam o que estava escrito', async () => {
      const v = await venda()
      const a = (await receber('admin', v, { parcela: 1, valor: 840 })).json().recibo
      await receber('admin', v, { parcela: 2, valor: 840 })
      expect((await req('GET', `/api/recibos/${a.id}`, 'admin')).json()).toMatchObject({ faltaDepois: 2520, restantes: 3, mensagem: a.mensagem })
    })
    it('o cobrador só abre recibo de cliente da carteira dele (404 nos outros)', async () => {
      const v = await venda(id.cB)
      const r = (await receber('cobrador2', v, { parcela: 1, valor: 840 })).json().recibo.id
      expect((await req('GET', `/api/recibos/${r}`, 'cobrador')).statusCode).toBe(404)
      expect((await req('GET', `/api/recibos/${r}`, 'cobrador2')).statusCode).toBe(200)
      expect((await req('GET', `/api/recibos/${r}`, 'admin')).statusCode).toBe(200)
      expect((await req('GET', '/api/recibos/abc', 'admin')).statusCode).toBe(400)
    })
    it('o nome da empresa vem da configuração (sem o "LTDA" no WhatsApp)', async () => {
      await db!('sistema_config').where({ chave: 'empresa_nome' }).update({ valor: JSON.stringify('Loja Exemplo LTDA') })
      const v = await venda()
      const r = (await receber('admin', v, { parcela: 1, valor: 840 })).json().recibo
      expect(r.empresa.nome).toBe('Loja Exemplo LTDA')
      expect(r.mensagem.startsWith('*Loja Exemplo* ·')).toBe(true)
    })
  })

  describe('cobranças: busca pelo nome do cliente', () => {
    const buscar = async (papel: string, b: string, aba = 'proximas') => (await req('GET', `/api/cobrancas?aba=${aba}&limite=100&busca=${encodeURIComponent(b)}`, papel)).json()
    it('acha pelo pedaço do nome, sem acento e sem maiúscula; o que não bate some; vazio traz tudo', async () => {
      const [c] = await db!('clientes').insert({ nome: 'José Conceição Álvares', fone: '11900000099', responsavel_id: id.cobrador }).returning('id')
      const [b] = await db!('bens').insert({ modelo: 'iPhone 11', gb: 64, cor: 'Preto', preco_venda: 2000, valor_compra: 1000, data_compra: '2026-09-01' }).returning('id')
      const r = await req('POST', '/api/vendas', 'admin', { aparelhoId: b.id, clienteId: c.id, preco: 2000, entrada: 500, parcelas: 3, diaVencimento: 10 })
      expect(r.statusCode).toBe(201)
      for (const q of ['jose', 'JOSÉ', 'conceicao', 'alvares', 'ao alv', 'Álvares']) {
        const itens = (await buscar('admin', q, 'hoje')).itens.concat((await buscar('admin', q, 'proximas')).itens)
        expect(itens.some((x: { cliente: { nome: string } }) => x.cliente.nome === 'José Conceição Álvares'), q).toBe(true)
      }
      expect((await buscar('admin', 'zzzz')).itens).toHaveLength(0)
      expect((await buscar('admin', '')).itens.length).toBeGreaterThan(0)
    })
    it('o cobrador só acha dentro da carteira dele; o caractere % não vira curinga; busca enorme é 400', async () => {
      expect((await buscar('cobrador2', 'jose')).itens.concat((await buscar('cobrador2', 'jose', 'hoje')).itens)).toHaveLength(0)
      expect((await buscar('admin', '%')).itens).toHaveLength(0)
      expect((await req('GET', `/api/cobrancas?busca=${'x'.repeat(81)}`, 'admin')).statusCode).toBe(400)
    })
  })

  describe('cobranças', () => {
    const itens = async (papel: string, aba: string) => (await req('GET', `/api/cobrancas?aba=${aba}&limite=100`, papel)).json()
    it('separa atrasadas, esta semana, próximas e recebidas, com contagens e valor total', async () => {
      await db!.raw('truncate table auditoria, recebimentos, transacoes_recebimento, venda_parcelas, vendas, bens restart identity cascade')
      const v = await venda(id.cA) // vencimentos: 10/11, 10/12, 10/01, 10/02
      hoje = '2026-11-12' // 1ª atrasada (2 dias); 2ª em 28 dias (próximas); nenhuma esta semana
      const atr = await itens('admin', 'atrasadas')
      expect(atr.itens).toHaveLength(1)
      expect(atr.itens[0]).toMatchObject({ tipo: 'VENDA', operacaoId: v, parcela: 1, nParcelas: 4, falta: 840, atrasoDias: 2, vencimento: '2026-11-10', cliente: { nome: 'Ana Souza' }, aparelho: 'iPhone 13' })
      expect(atr.valorTotal).toBe(840)
      expect(atr.contagens).toEqual({ atrasadas: 1, hoje: 0, proximas: 1 })
      expect((await itens('admin', 'proximas')).itens.map((x: { parcela: number }) => x.parcela)).toEqual([2])
      hoje = '2026-12-08' // a 2ª vence em 2 dias: esta semana
      expect((await itens('admin', 'hoje')).itens.map((x: { parcela: number }) => x.parcela)).toEqual([2])
    })
    it('parcela paga sai das abertas e entra nas recebidas (últimos 30 dias); a parcial continua aberta com o resto', async () => {
      const v = await venda(id.cA)
      hoje = '2026-11-12'
      const rec = (await receber('admin', v, { parcela: 1, valor: 100, resto: 'FICA', novoVencimento: '2026-11-19' })).json().recibo.id
      const atr = await itens('admin', 'atrasadas')
      expect(atr.itens.filter((x: { operacaoId: number }) => x.operacaoId === v)).toHaveLength(0) // remarcada: saiu dos atrasados
      const hojeAba = (await itens('admin', 'hoje')).itens.find((x: { operacaoId: number }) => x.operacaoId === v)
      expect(hojeAba).toMatchObject({ parcela: 1, falta: 740, pago: 100, vencimento: '2026-11-19', vencimentoOriginal: '2026-11-10' })
      const recebidas = (await itens('admin', 'recebidas')).itens.find((x: { operacaoId: number }) => x.operacaoId === v)
      expect(recebidas).toMatchObject({ parcela: 1, pago: 100, ultimaTransacaoId: rec, ultimoRecebimentoEm: '2026-11-12' })
      hoje = '2026-12-20' // passou de 30 dias
      expect((await itens('admin', 'recebidas')).itens.find((x: { operacaoId: number }) => x.operacaoId === v)).toBeUndefined()
    })
    it('o cobrador só vê a carteira dele; recebimento desfeito deixa de contar; venda retomada some', async () => {
      const a = await venda(id.cA)
      const b = await venda(id.cB)
      hoje = '2026-11-12'
      const dele = (await itens('cobrador', 'atrasadas')).itens.map((x: { operacaoId: number }) => x.operacaoId)
      expect(dele).toContain(a)
      expect(dele).not.toContain(b)
      const rec = (await receber('cobrador', a, { parcela: 1, valor: 840 })).json().recibo.id
      expect((await itens('cobrador', 'atrasadas')).itens.map((x: { operacaoId: number }) => x.operacaoId)).not.toContain(a)
      await req('POST', `/api/recebimentos/${rec}/desfazer`, 'cobrador')
      expect((await itens('cobrador', 'atrasadas')).itens.map((x: { operacaoId: number }) => x.operacaoId)).toContain(a)
      await db!('vendas').where({ id: a }).update({ status: 'RETOMADA' })
      expect((await itens('admin', 'atrasadas')).itens.map((x: { operacaoId: number }) => x.operacaoId)).not.toContain(a)
    })
    it('aba inválida é 400; pagina e corta o limite em 100', async () => {
      expect((await req('GET', '/api/cobrancas?aba=xyz', 'admin')).statusCode).toBe(400)
      expect((await req('GET', '/api/cobrancas?limite=99999', 'admin')).json().limite).toBe(100)
      expect((await req('GET', '/api/cobrancas?aba=proximas&limite=1&pagina=2', 'admin')).json().itens.length).toBeLessThanOrEqual(1)
    })
  })

  describe('auditoria', () => {
    it('grava quem deu a baixa, com os efeitos', async () => {
      const v = await venda(id.cA)
      const r = (await receber('cobrador', v, { parcela: 1, valor: 840, forma: 'DINHEIRO' })).json().recibo
      const a = await db!('auditoria').where({ acao: 'RECEBIMENTO_REGISTRADO', entidade_id: v }).first()
      expect(a).toMatchObject({ usuario_id: id.cobrador })
      expect(a.depois).toMatchObject({ transacaoId: r.id, parcela: 1, valor: 840, forma: 'DINHEIRO', efeitos: [{ tipo: 'QUITA', numero: 1 }] })
    })
  })
})
