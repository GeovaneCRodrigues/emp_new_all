import type { FastifyInstance } from 'fastify'
import type { Knex } from 'knex'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { createAprovacoesRepository } from '../src/modules/aprovacoes/models/repository.js'
import { createAprovacoesService } from '../src/modules/aprovacoes/services/aprovacoes.service.js'
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

describe.skipIf(!db)('o cobrador só enxerga os indicadores que o administrador marcou (Postgres de verdade)', () => {
  let app: FastifyInstance
  const hoje = '2026-10-08'
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}

  const req = (metodo: 'GET' | 'POST' | 'PATCH', url: string, papel?: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  const marcar = (alvo: number, indicadorIds: unknown, papel = 'admin') => req('PATCH', `/api/equipe/${alvo}`, papel, { indicadorIds })
  const clientesDele = async () => (await req('GET', '/api/clientes?limite=100', 'cobrador')).json().itens.map((c: { nome: string }) => c.nome).sort()
  const cobrancasDele = async () => (await req('GET', '/api/cobrancas?aba=proximas&limite=100', 'cobrador')).json().itens.map((c: { cliente: { nome: string } }) => c.cliente.nome).sort()
  const emprestimosDele = async () => (await req('GET', '/api/emprestimos?limite=100', 'cobrador')).json().itens.map((e: { cliente: { nome: string } }) => e.cliente.nome).sort()
  const vendasDele = async () => (await req('GET', '/api/vendas?limite=100', 'cobrador')).json().itens.map((v: { cliente: { nome: string } }) => v.cliente.nome).sort()

  async function venda(clienteId: number, indicadorId: number | null): Promise<number> {
    const [b] = await db!('bens').insert({ modelo: 'iPhone 13', gb: 128, cor: 'Preto', preco_venda: 3000, valor_compra: 2000, data_compra: '2026-09-01' }).returning('id')
    const r = await req('POST', '/api/vendas', 'admin', { aparelhoId: b.id, clienteId, ...(indicadorId ? { indicadorId } : {}), preco: 3000, entrada: 600, parcelas: 4, diaVencimento: 10 })
    expect(r.statusCode).toBe(201)
    return r.json().id
  }
  async function emprestimo(clienteId: number, indicadorId: number | null): Promise<number> {
    const r = await req('POST', '/api/emprestimos', 'admin', { clienteId, ...(indicadorId ? { indicadorId } : {}), modalidade: 'JUROS', capital: 3000, taxa: 12, parcelas: 3 })
    expect(r.statusCode).toBe(201)
    return r.json().id
  }

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    const hash = await hashSenha(SENHA)
    for (const [chave, nome, pct] of [['deda', 'Deda', 0.5], ['filipe', 'Filipe', 0.5], ['lucas', 'Lucas', 0.5]] as const) {
      const [i] = await k('indicadores').insert({ nome, pct }).returning('id'); id[chave] = i.id
    }
    for (const [chave, perfil] of [['admin', 'ADMIN'], ['vendedor', 'VENDEDOR'], ['cobrador', 'COBRADOR'], ['cobrador2', 'COBRADOR']] as const) {
      const [u] = await k('users').insert({ nome: `${chave} Silva`, email: `${chave}@t.com`, senha_hash: hash, perfil }).returning('id'); id[chave] = u.id
    }
    // o responsável do cliente NÃO dá carteira ao cobrador: todos têm o cobrador 1 como responsável
    for (const [chave, nome] of [['ana', 'Ana do Deda'], ['bia', 'Bia do Filipe'], ['caio', 'Caio do Lucas'], ['dani', 'Dani sem indicador']] as const) {
      const [c] = await k('clientes').insert({ nome, fone: '11988124410', responsavel_id: id.cobrador }).returning('id'); id[chave] = c.id
    }
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
      aprovacoes: createAprovacoesService({ repo: createAprovacoesRepository(k), auditoria: audit, hoje: () => hoje }),
      fechamentos: createFechamentosService({ repo: createFechamentosRepository(k), auditoria: audit, hoje: () => hoje }),
      equipe: createEquipeService({ repo: createEquipeRepository(k), auditoria: audit, hoje: () => hoje }),
      limites: { vendasPorMinuto: 100_000, recebimentosPorMinuto: 100_000, geralPorMinuto: 100_000 },
    })
    for (const papel of ['admin', 'vendedor', 'cobrador', 'cobrador2']) {
      t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
    }
    id.vAna = await venda(id.ana, id.deda)
    id.eBia = await emprestimo(id.bia, id.filipe)
    id.vCaio = await venda(id.caio, id.lucas)
    id.eDani = await emprestimo(id.dani, null)
  })
  afterAll(async () => { await app?.close(); await db?.destroy() })

  describe('quem marca', () => {
    it('só o administrador marca (403 para os outros, 401 sem login)', async () => {
      for (const papel of ['vendedor', 'cobrador']) expect((await marcar(id.cobrador, [id.deda], papel)).statusCode).toBe(403)
      expect((await req('PATCH', `/api/equipe/${id.cobrador}`, undefined, { indicadorIds: [id.deda] })).statusCode).toBe(401)
    })
    it('só cobrador atende indicador; o indicador tem que existir; o formato é conferido', async () => {
      expect((await marcar(id.vendedor, [id.deda])).statusCode).toBe(400)
      expect((await marcar(id.admin, [id.deda])).statusCode).toBe(403) // o admin não é alterado por aqui
      expect((await marcar(id.cobrador, [999999])).statusCode).toBe(400)
      for (const ruim of ['deda', 5, null, [1.5], ['1'], [0], [-3], [{}]]) expect((await marcar(id.cobrador, ruim)).statusCode, JSON.stringify(ruim)).toBe(400)
      expect((await marcar(id.cobrador, new Array(501).fill(1))).statusCode).toBe(400)
      expect((await marcar(999999, [id.deda])).statusCode).toBe(404)
    })
  })

  describe('sem nenhum indicador marcado, o cobrador não vê nada (mesmo sendo o responsável pelos clientes)', () => {
    it('clientes, cobranças, empréstimos, vendas e recibo vazios', async () => {
      expect(await clientesDele()).toEqual([])
      expect(await cobrancasDele()).toEqual([])
      expect(await emprestimosDele()).toEqual([])
      expect(await vendasDele()).toEqual([])
      expect((await req('GET', `/api/emprestimos/${id.eBia}`, 'cobrador')).statusCode).toBe(404)
      expect((await req('GET', `/api/vendas/${id.vAna}`, 'cobrador')).statusCode).toBe(404)
    })
  })

  describe('com indicadores marcados', () => {
    it('vê só o que vem do Deda; não vê o Filipe, o Lucas nem o cliente sem indicador', async () => {
      const r = await marcar(id.cobrador, [id.deda])
      expect(r.statusCode).toBe(200)
      expect(r.json().indicadorIds).toEqual([id.deda])
      expect(await clientesDele()).toEqual(['Ana do Deda'])
      expect((await cobrancasDele()).every((n: string) => n === 'Ana do Deda')).toBe(true)
      expect((await cobrancasDele()).length).toBeGreaterThan(0)
      expect(await vendasDele()).toEqual(['Ana do Deda'])
      expect(await emprestimosDele()).toEqual([])
      expect((await req('GET', `/api/vendas/${id.vAna}`, 'cobrador')).statusCode).toBe(200)
      expect((await req('GET', `/api/vendas/${id.vCaio}`, 'cobrador')).statusCode).toBe(404)
      expect((await req('GET', `/api/emprestimos/${id.eDani}`, 'cobrador')).statusCode).toBe(404)
    })
    it('vários indicadores somam; o outro cobrador, sem marcação, continua sem ver nada', async () => {
      expect((await marcar(id.cobrador, [id.deda, id.filipe])).statusCode).toBe(200)
      expect(await clientesDele()).toEqual(['Ana do Deda', 'Bia do Filipe'])
      expect(await emprestimosDele()).toEqual(['Bia do Filipe'])
      expect(await vendasDele()).toEqual(['Ana do Deda'])
      expect((await req('GET', '/api/cobrancas?aba=proximas&limite=100', 'cobrador2')).json().itens).toEqual([])
      expect((await req('GET', '/api/clientes?limite=100', 'cobrador2')).json().itens).toEqual([])
    })
    it('o mesmo indicador pode ser atendido por mais de um cobrador', async () => {
      expect((await marcar(id.cobrador2, [id.deda])).statusCode).toBe(200)
      expect((await req('GET', '/api/vendas?limite=100', 'cobrador2')).json().itens.map((v: { cliente: { nome: string } }) => v.cliente.nome)).toEqual(['Ana do Deda'])
    })
    it('só cobra e dá baixa no que é dos indicadores dele; no resto, 404', async () => {
      const dele = await req('POST', `/api/vendas/${id.vAna}/recebimentos`, 'cobrador', { forma: 'PIX', parcela: 1, valor: 840 })
      expect(dele.statusCode).toBe(201)
      expect((await req('POST', `/api/vendas/${id.vCaio}/recebimentos`, 'cobrador', { forma: 'PIX', parcela: 1, valor: 840 })).statusCode).toBe(404)
      expect((await req('POST', `/api/emprestimos/${id.eDani}/recebimentos`, 'cobrador', { forma: 'PIX', parcela: 1, valor: 360 })).statusCode).toBe(404)
      // o recibo da baixa dele abre; o recibo de outro (feito pelo admin num cliente do Lucas) não
      expect((await req('GET', `/api/recibos/${dele.json().recibo.id}`, 'cobrador')).statusCode).toBe(200)
      const doLucas = await req('POST', `/api/vendas/${id.vCaio}/recebimentos`, 'admin', { forma: 'PIX', parcela: 1, valor: 840 })
      expect(doLucas.statusCode).toBe(201)
      expect((await req('GET', `/api/recibos/${doLucas.json().recibo.id}`, 'cobrador')).statusCode).toBe(404)
    })
    it('desmarcar tira o acesso na hora; lista vazia tira tudo', async () => {
      expect((await marcar(id.cobrador, [id.filipe])).statusCode).toBe(200)
      expect(await clientesDele()).toEqual(['Bia do Filipe'])
      expect((await marcar(id.cobrador, [])).statusCode).toBe(200)
      expect(await clientesDele()).toEqual([])
    })
    it('repetidos contam uma vez só', async () => {
      const r = await marcar(id.cobrador, [id.deda, id.deda, id.deda])
      expect(r.statusCode).toBe(200)
      expect(r.json().indicadorIds).toEqual([id.deda])
    })
  })

  describe('na tela Equipe', () => {
    it('o cobrador lista os indicadores dele e quantos clientes tem; os outros perfis não trazem o campo', async () => {
      await marcar(id.cobrador, [id.deda, id.filipe])
      const lista = (await req('GET', '/api/equipe', 'admin')).json() as { id: number; perfil: string; carteira: number; indicadorIds?: number[] }[]
      const c = lista.find((p) => p.id === id.cobrador)!
      expect(c.indicadorIds).toEqual([id.deda, id.filipe].sort((a, b) => a - b))
      expect(c.carteira).toBe(2)
      expect(lista.find((p) => p.id === id.cobrador2)!.carteira).toBe(1) // só o Deda
      expect(lista.find((p) => p.id === id.vendedor)).not.toHaveProperty('indicadorIds')
    })
    it('fica na auditoria o que era e o que passou a ser', async () => {
      await marcar(id.cobrador, [id.lucas])
      const l = await db!('auditoria').where({ acao: 'EQUIPE_ALTERADO', entidade_id: id.cobrador }).orderBy('id', 'desc').first()
      expect(l.antes.indicadorIds).toEqual([id.deda, id.filipe].sort((a: number, b: number) => a - b))
      expect(l.depois.indicadorIds).toEqual([id.lucas])
    })
    it('apagar o indicador tira o vínculo sem quebrar o cobrador', async () => {
      const [novo] = await db!('indicadores').insert({ nome: 'Temporário', pct: 0.5 }).returning('id')
      await marcar(id.cobrador, [novo.id])
      await db!('indicadores').where({ id: novo.id }).delete()
      expect(await db!('cobrador_indicadores').where({ usuario_id: id.cobrador }).count({ n: '*' }).first().then((r) => Number(r!.n))).toBe(0)
      expect((await req('GET', '/api/equipe', 'admin')).statusCode).toBe(200)
    })
  })
})
