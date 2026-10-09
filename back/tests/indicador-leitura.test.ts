import type { FastifyInstance } from 'fastify'
import type { Knex } from 'knex'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { createAuditoriaRepository } from '../src/modules/auditoria/models/repository.js'
import { createSessoesRepository, createUsuariosRepository } from '../src/modules/auth/models/repository.js'
import { createAuthService } from '../src/modules/auth/services/auth.service.js'
import { hashSenha } from '../src/modules/auth/services/password.js'
import { createTokensService } from '../src/modules/auth/services/tokens.js'
import { createClientesRepository } from '../src/modules/clientes/models/repository.js'
import { createClientesService } from '../src/modules/clientes/services/clientes.service.js'
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
/** Campos que são só da loja: o indicador nunca pode recebê-los (nem zerados: nem existem). */
const SO_DA_LOJA = ['custoNoDia', 'lucroTotal', 'seuLucro', 'lucroRealizado', 'capitalDeVolta', 'parteIndicador', 'capital', 'taxa', 'capitalAberto', 'investido']

describe.skipIf(!db)('o indicador lê só o que é dele (Postgres de verdade)', () => {
  let app: FastifyInstance
  const hoje = '2026-10-08'
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}

  const req = (metodo: 'GET' | 'POST' | 'PATCH', url: string, papel?: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  const lista = async (url: string, papel: string) => (await req('GET', url, papel)).json()

  /** Venda de 3.000 (custo 2.000), entrada 600 e 4x de 840, para o cliente, com o indicador. */
  async function venda(cliente: number, indicador: number | null): Promise<number> {
    const [b] = await db!('bens').insert({ modelo: 'iPhone 13', gb: 128, cor: 'Preto', preco_venda: 3000, valor_compra: 2000, custos_extras: 50, data_compra: '2026-09-01' }).returning('id')
    const r = await req('POST', '/api/vendas', 'admin', { aparelhoId: b.id, clienteId: cliente, preco: 3000, entrada: 600, parcelas: 4, diaVencimento: 10, ...(indicador ? { indicadorId: indicador } : {}) })
    expect(r.statusCode, r.body).toBe(201)
    return r.json().id
  }
  async function emprestimo(cliente: number, indicador: number | null): Promise<number> {
    const r = await req('POST', '/api/emprestimos', 'admin', { clienteId: cliente, modalidade: 'PARCELADO', capital: 1000, taxa: 30, parcelas: 2, ...(indicador ? { indicadorId: indicador } : {}) })
    expect(r.statusCode, r.body).toBe(201)
    return r.json().id
  }

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    await k('sistema_config').where({ chave: 'juros_parcela_pct' }).update({ valor: JSON.stringify(10) })
    await k('sistema_config').where({ chave: 'max_parcelas' }).update({ valor: JSON.stringify(10) })
    const hash = await hashSenha(SENHA)
    for (const [chave, nome] of [['roberto', 'Roberto'], ['carla', 'Carla']] as const) {
      const [i] = await k('indicadores').insert({ nome, pct: 0.5, pct_manual: true }).returning('id')
      id[chave] = i.id
    }
    for (const [chave, perfil, extra] of [['admin', 'ADMIN', {}], ['cobrador', 'COBRADOR', {}], ['vendedor', 'VENDEDOR', {}], ['indicador', 'INDICADOR', { indicador_id: id.roberto }], ['indicador2', 'INDICADOR', { indicador_id: id.carla }]] as const) {
      const [u] = await k('users').insert({ nome: `${chave} Silva`, email: `${chave}@t.com`, senha_hash: hash, perfil, ...extra }).returning('id')
      id[chave] = u.id
    }
    for (const [chave, nome] of [['ana', 'Ana Souza'], ['bia', 'Bia Lima']] as const) { const [c] = await k('clientes').insert({ nome, fone: '1198812441' + (chave === 'ana' ? 0 : 1) }).returning('id'); id[chave] = c.id }

    const tokens = createTokensService('x'.repeat(40), '15m')
    const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
    const audit = createAuditoriaRepository(k)
    const indicadores = createIndicadoresService(createIndicadoresRepository(k), audit)
    const config = createConfigRepository(k)
    app = await buildApp({
      env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, usuarios: {} as never, indicadores,
      clientes: createClientesService(createClientesRepository(k), audit),
      estoque: createEstoqueService(createEstoqueRepository(k), audit), config: createConfigService(config),
      vendas: createVendasService({ vendas: createVendasRepository(k), config, auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis(), hoje: () => hoje }),
      emprestimos: createEmprestimosService({ emprestimos: createEmprestimosRepository(k), auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis(), hoje: () => hoje }),
      recebimentos: createRecebimentosService({ repo: createRecebimentosRepository(k), auditoria: audit, hoje: () => hoje }),
      aprovacoes: {} as never, fechamentos: {} as never, equipe: {} as never,
      limites: { vendasPorMinuto: 100_000, recebimentosPorMinuto: 100_000 },
    })
    for (const papel of ['admin', 'cobrador', 'vendedor', 'indicador', 'indicador2']) t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  })
  beforeEach(async () => {
    for (const tb of ['recebimentos', 'transacoes_recebimento', 'venda_parcelas', 'emprestimo_parcelas', 'vendas', 'emprestimos', 'bens']) await db!(tb).del()
  })
  afterAll(async () => { await app?.close(); await db?.destroy() })

  describe('vendas', () => {
    it('lista só as dele (outras do mesmo cliente, de outro indicador ou sem indicador, não aparecem)', async () => {
      const minha = await venda(id.ana, id.roberto); await venda(id.ana, id.carla); await venda(id.bia, null)
      const r = await lista('/api/vendas', 'indicador')
      expect(r.total).toBe(1); expect(r.itens[0].id).toBe(minha)
      expect((await lista('/api/vendas', 'indicador2')).total).toBe(1)
      expect((await lista('/api/vendas', 'admin')).total).toBe(3)
    })
    it('mostra a parte dele (prevista e já liberada) e o %, e nunca custo, lucro, capital nem a parte da loja', async () => {
      const v = await venda(id.ana, id.roberto)
      for (const p of [1, 2, 3]) expect((await req('POST', `/api/vendas/${v}/recebimentos`, 'admin', { forma: 'PIX', parcela: p, valor: 840 })).statusCode).toBe(201)
      const [item] = (await lista('/api/vendas', 'indicador')).itens
      // custo 2.050 (com extras); total 3.960; lucro 1.910; 50% = 955 previsto. Recebido 600 + 2.520 = 3.120 → 1.070 passou do capital → 535 liberado
      expect(item).toMatchObject({ id: v, percentualIndicador: 0.5, suaParte: 955, jaLiberado: 535, total: 3960, recebido: 3120, cliente: { nome: 'Ana Souza' } })
      for (const campo of SO_DA_LOJA) expect(campo in item, campo).toBe(false)
      expect(JSON.stringify(item)).not.toMatch(/2050|2000|1910|lucro|custo/i)
    })
    it('a ficha: a dele abre; a de outro indicador, a sem indicador e a inexistente dão 404; id inválido 400', async () => {
      const a = await venda(id.ana, id.roberto); const b = await venda(id.ana, id.carla); const c = await venda(id.bia, null)
      expect((await req('GET', `/api/vendas/${a}`, 'indicador')).statusCode).toBe(200)
      for (const outra of [b, c, 999999]) expect((await req('GET', `/api/vendas/${outra}`, 'indicador')).statusCode).toBe(404)
      expect((await req('GET', '/api/vendas/abc', 'indicador')).statusCode).toBe(400)
    })
    it('o resumo traz só o a receber das dele', async () => {
      await venda(id.ana, id.roberto); await venda(id.ana, id.carla)
      const r = await lista('/api/vendas/resumo', 'indicador')
      expect(Object.keys(r)).toEqual(['aReceber'])
      expect(r.aReceber).toBe(3360)
    })
    it('o motivo da retomada (anotação da loja) não chega ao indicador', async () => {
      const v = await venda(id.ana, id.roberto)
      await db!('vendas').where({ id: v }).update({ status: 'RETOMADA', retomada_em: '2026-10-01', retomada_motivo: 'Cliente sumiu e não atende' })
      const r = (await req('GET', `/api/vendas/${v}`, 'indicador')).json()
      expect(r.status).toBe('RETOMADA')
      expect(JSON.stringify(r)).not.toContain('sumiu')
    })
    it('não vende nem retoma (403) e continua sem login 401', async () => {
      const v = await venda(id.ana, id.roberto)
      expect((await req('POST', '/api/vendas', 'indicador', { aparelhoId: 1, clienteId: id.ana })).statusCode).toBe(403)
      expect((await req('POST', `/api/vendas/${v}/retomar`, 'indicador', {})).statusCode).toBe(403)
      expect((await req('GET', '/api/vendas')).statusCode).toBe(401)
    })
  })

  describe('empréstimos', () => {
    it('lista só os dele, com a parte dele e sem capital, taxa nem lucro', async () => {
      const meu = await emprestimo(id.ana, id.roberto); await emprestimo(id.ana, id.carla); await emprestimo(id.bia, null)
      const r = await lista('/api/emprestimos', 'indicador')
      expect(r.total).toBe(1)
      const e = r.itens[0]
      expect(e).toMatchObject({ id: meu, percentualIndicador: 0.5, suaParte: 150, jaLiberado: 0, total: 1300 }) // lucro 300 × 50%
      for (const campo of SO_DA_LOJA) expect(campo in e, campo).toBe(false)
      expect(JSON.stringify(r)).not.toMatch(/capital|taxa|lucro/i)
    })
    it('libera conforme o capital volta (1.300 pagos: 150 liberados)', async () => {
      const e = await emprestimo(id.ana, id.roberto)
      expect((await req('POST', `/api/emprestimos/${e}/recebimentos`, 'admin', { forma: 'PIX', parcela: 1, valor: 650 })).statusCode).toBe(201)
      expect((await lista('/api/emprestimos', 'indicador')).itens[0].jaLiberado).toBe(0) // 650 < capital 1.000
      expect((await req('POST', `/api/emprestimos/${e}/recebimentos`, 'admin', { forma: 'PIX', parcela: 2, valor: 650 })).statusCode).toBe(201)
      expect((await lista('/api/emprestimos', 'indicador')).itens[0].jaLiberado).toBe(150)
    })
    it('a ficha: a dele abre; de outro indicador, sem indicador e inexistente dão 404; não cria empréstimo (403)', async () => {
      const a = await emprestimo(id.ana, id.roberto); const b = await emprestimo(id.ana, id.carla); const c = await emprestimo(id.bia, null)
      expect((await req('GET', `/api/emprestimos/${a}`, 'indicador')).statusCode).toBe(200)
      for (const outra of [b, c, 999999]) expect((await req('GET', `/api/emprestimos/${outra}`, 'indicador')).statusCode).toBe(404)
      expect((await req('POST', '/api/emprestimos', 'indicador', { clienteId: id.ana, modalidade: 'PARCELADO', capital: 100, taxa: 10, parcelas: 1 })).statusCode).toBe(403)
    })
  })

  describe('cobranças', () => {
    it('o indicador vê as parcelas das operações dele (venda e empréstimo), e só elas', async () => {
      await venda(id.ana, id.roberto); await emprestimo(id.ana, id.roberto)
      await venda(id.ana, id.carla); await emprestimo(id.bia, null)
      // todas vencendo na janela de "próximas" (16/10 a 22/11)
      await db!('venda_parcelas').update({ vencimento: '2026-10-20' }); await db!('emprestimo_parcelas').update({ vencimento: '2026-10-20' })
      const r = await lista('/api/cobrancas?aba=proximas&limite=100', 'indicador')
      const tipos = new Set(r.itens.map((l: { tipo: string }) => l.tipo))
      expect(tipos).toEqual(new Set(['VENDA', 'EMPRESTIMO']))
      expect(r.itens.length).toBe(4 + 2) // 4 parcelas da venda + 2 do empréstimo
      const outro = await lista('/api/cobrancas?aba=proximas&limite=100', 'indicador2')
      expect(outro.itens.length).toBe(4)
    })
    it('atrasada aparece com os dias e o telefone do cliente (para o WhatsApp), e as outras abas funcionam', async () => {
      const v = await venda(id.ana, id.roberto)
      await db!('venda_parcelas').where({ venda_id: v, numero: 1 }).update({ vencimento: '2026-10-01' })
      const r = await lista('/api/cobrancas?aba=atrasadas', 'indicador')
      expect(r.itens).toHaveLength(1)
      expect(r.itens[0]).toMatchObject({ atrasoDias: 7, cliente: { nome: 'Ana Souza', fone: '11988124410' } })
      expect(r.contagens.atrasadas).toBe(1)
      for (const aba of ['hoje', 'recebidas']) expect((await req('GET', `/api/cobrancas?aba=${aba}`, 'indicador')).statusCode).toBe(200)
    })
    it('a busca por nome só acha cliente dele', async () => {
      await venda(id.ana, id.roberto); await venda(id.bia, id.carla)
      await db!('venda_parcelas').update({ vencimento: '2026-10-20' })
      expect((await lista('/api/cobrancas?aba=proximas&busca=bia', 'indicador')).itens).toHaveLength(0)
      expect((await lista('/api/cobrancas?aba=proximas&busca=ana', 'indicador')).itens.length).toBeGreaterThan(0)
    })
    it('o indicador NÃO registra recebimento, não vê recibo nem desfaz (403): isso é só da loja e do cobrador', async () => {
      const v = await venda(id.ana, id.roberto)
      const antes = async () => Number((await db!('recebimentos').count('* as n').first() as { n: string }).n) // a entrada da venda já é um recebimento
      const n0 = await antes()
      expect((await req('POST', `/api/vendas/${v}/recebimentos`, 'indicador', { forma: 'PIX', parcela: 1, valor: 840 })).statusCode).toBe(403)
      expect((await req('GET', '/api/recibos/1', 'indicador')).statusCode).toBe(403)
      expect((await req('POST', '/api/recebimentos/1/desfazer', 'indicador')).statusCode).toBe(403)
      expect((await req('GET', `/api/vendas/${v}/pagamentos`, 'indicador')).statusCode).toBe(403)
      expect(await antes()).toBe(n0)
    })
    it('vendedor continua sem ver cobranças (403)', async () => {
      expect((await req('GET', '/api/cobrancas', 'vendedor')).statusCode).toBe(403)
    })
  })
})
