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
import { createNotificacoesRepository } from '../src/modules/notificacoes/models/repository.js'
import { createNotificacoesService, type NotificacoesService } from '../src/modules/notificacoes/services/notificacoes.service.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()
const SENHA = 'senha-forte-123'

type Lista = { itens: { id: number; tipo: string; texto: string; rota: string | null; lida: boolean }[]; naoLidas: number }

describe.skipIf(!db)('notificações do sino (Postgres de verdade)', () => {
  let app: FastifyInstance
  let servico: NotificacoesService
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}
  let dia = '2026-11-06'
  let atrasos: Record<string, { atrasadas: number; hoje: number }> = {}
  const req = (metodo: 'GET' | 'POST', url: string, papel?: string) => app.inject({ method: metodo, url, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  const lista = async (papel: string) => (await req('GET', '/api/notificacoes', papel)).json() as Lista
  const fato = (acao: string, entidade: string, entidadeId: number, usuarioId: number | null, depois: unknown = {}) =>
    createAuditoriaRepository(db!).registrar({ usuarioId, acao, entidade, entidadeId, depois })
  let seq = 0
  async function contrato(numero: string, cliente = id.cli) {
    const [b] = await db!('bens').insert({ modelo: 'IPHONE 15', gb: 128, cor: 'PRETO', imei: `35693803564${String(1000 + ++seq).padStart(4, '0')}`, preco_venda: 3000, valor_compra: 2000, custos_extras: 0, data_compra: '2026-09-01', estado: 'VENDIDO' }).returning('id')
    const [v] = await db!('vendas').insert({ bem_id: b.id, cliente_id: cliente, vendedor_id: id.vendedor, data_venda: '2026-10-05', preco_acordado: 3000, entrada: 1000, troca_valor: 0, valor_investido: 2000, valor_total: 3000, status: 'ATIVA', contrato_status: 'AGUARDANDO' }).returning('id')
    const [c] = await db!('contratos').insert({ venda_id: v.id, numero }).returning('id')
    return { vendaId: v.id as number, contratoId: c.id as number }
  }

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    const hash = await hashSenha(SENHA)
    for (const [c, perfil] of [['admin', 'ADMIN'], ['admin2', 'ADMIN'], ['vendedor', 'VENDEDOR'], ['cobrador', 'COBRADOR']] as const) {
      id[c] = (await k('users').insert({ nome: c, email: `${c}@t.com`, senha_hash: hash, perfil }).returning('id'))[0].id
    }
    id.inativo = (await k('users').insert({ nome: 'inativo', email: 'inativo@t.com', senha_hash: hash, perfil: 'ADMIN', ativo: false }).returning('id'))[0].id
    id.cli = (await k('clientes').insert({ nome: 'ANA SOUZA', fone: '11988124410' }).returning('id'))[0].id
    const tokens = createTokensService('x'.repeat(40), '15m')
    const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
    const audit = createAuditoriaRepository(k)
    servico = createNotificacoesService({
      repo: createNotificacoesRepository(k), hoje: () => dia,
      atrasos: async (s) => atrasos[String(s.usuarioId)] ?? { atrasadas: 0, hoje: 0 },
    })
    app = await buildApp({
      env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, clientes: {} as never, usuarios: {} as never,
      indicadores: createIndicadoresService(createIndicadoresRepository(k), audit),
      estoque: createEstoqueService(createEstoqueRepository(k), audit), config: createConfigService(createConfigRepository(k)), vendas: {} as never, recebimentos: {} as never,
      aprovacoes: {} as never, fechamentos: {} as never, equipe: {} as never, notificacoes: servico,
      limites: { vendasPorMinuto: 100_000, recebimentosPorMinuto: 100_000 },
    })
    for (const papel of ['admin', 'admin2', 'vendedor', 'cobrador']) t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  })
  beforeEach(async () => {
    const k = db!
    for (const tab of ['notificacoes', 'notificacoes_estado', 'contratos', 'recebimentos', 'transacoes_recebimento', 'venda_parcelas', 'vendas', 'bens', 'auditoria']) await k(tab).del()
    dia = '2026-11-06'
    atrasos = {}
    await servico.sincronizar() // a primeira rodada só marca o ponto de partida
  })
  afterAll(async () => { await app?.close(); await db?.destroy() })

  it('sem login é 401', async () => {
    expect((await req('GET', '/api/notificacoes')).statusCode).toBe(401)
    expect((await req('POST', '/api/notificacoes/lidas')).statusCode).toBe(401)
  })

  it('não avisa o que já tinha acontecido antes de ligar', async () => {
    await db!('notificacoes_estado').del()
    await fato('PROPOSTA_CRIADA', 'proposta', 1, id.vendedor)
    await servico.sincronizar()
    expect((await lista('admin')).itens).toHaveLength(0)
    await fato('PROPOSTA_CRIADA', 'proposta', 2, id.vendedor)
    await servico.sincronizar()
    expect((await lista('admin')).itens).toHaveLength(1)
  })

  describe('contrato assinado', () => {
    it.each(['CONTRATO_ASSINADO', 'CONTRATO_ASSINADO_PELO_LINK', 'CONTRATO_ASSINADO_ZAPSIGN'])('%s avisa os administradores, com número e cliente', async (acao) => {
      const { contratoId } = await contrato('2026-0104')
      await fato(acao, 'contrato', contratoId, null)
      await servico.sincronizar()
      for (const papel of ['admin', 'admin2']) {
        const l = await lista(papel)
        expect(l.itens).toHaveLength(1)
        expect(l.itens[0]).toMatchObject({ tipo: 'contrato_assinado', texto: 'Contrato 2026-0104 assinado por ANA SOUZA.', rota: '/contratos', lida: false })
        expect(l.naoLidas).toBe(1)
      }
      expect((await lista('vendedor')).itens).toHaveLength(0)
      expect((await lista('cobrador')).itens).toHaveLength(0)
      expect(await db!('notificacoes').where({ usuario_id: id.inativo }).count('* as n').first()).toMatchObject({ n: '0' })
    })
    it('quem marcou como assinado à mão não recebe o próprio aviso', async () => {
      const { contratoId } = await contrato('2026-0105')
      await fato('CONTRATO_ASSINADO', 'contrato', contratoId, id.admin)
      await servico.sincronizar()
      expect((await lista('admin')).itens).toHaveLength(0)
      expect((await lista('admin2')).itens).toHaveLength(1)
    })
    it('contrato que sumiu ainda gera um aviso genérico', async () => {
      await fato('CONTRATO_ASSINADO_ZAPSIGN', 'contrato', 99999, null)
      await servico.sincronizar()
      expect((await lista('admin')).itens[0].texto).toBe('Um contrato foi assinado.')
    })
  })

  describe('pagamento recebido', () => {
    it('diz o valor e o cliente e avisa o admin que não lançou', async () => {
      const { vendaId } = await contrato('2026-0106')
      await fato('RECEBIMENTO_REGISTRADO', 'venda', vendaId, id.cobrador, { valor: 1250.5, parcela: 1 })
      await servico.sincronizar()
      const l = await lista('admin')
      expect(l.itens[0]).toMatchObject({ tipo: 'pagamento', texto: 'Recebido R$ 1.250,50 de ANA SOUZA.', rota: '/caixa' })
      expect((await lista('cobrador')).itens).toHaveLength(0)
    })
  })

  describe('pedidos esperando o admin', () => {
    it.each([['PROPOSTA_CRIADA', /proposta/i], ['DESCONTO_PEDIDO', /desconto/i], ['ACORDO_PEDIDO', /acordo/i], ['RETOMADA_PEDIDA', /retomada/i], ['BAIXA_AVISADA', /baixa/i]])('%s', async (acao, texto) => {
      await fato(acao, 'aprovacao', 7, id.cobrador)
      await servico.sincronizar()
      const l = await lista('admin')
      expect(l.itens).toHaveLength(1)
      expect(l.itens[0]).toMatchObject({ tipo: 'pedido', rota: '/' })
      expect(l.itens[0].texto).toMatch(texto)
    })
    it('fatos que não são de aviso são ignorados', async () => {
      await fato('CONTRATO_GERADO', 'contrato', 1, id.admin2)
      await fato('APROVACAO_APROVADA', 'aprovacao', 1, id.admin2)
      await servico.sincronizar()
      expect((await lista('admin')).itens).toHaveLength(0)
    })
  })

  describe('parcelas atrasadas e que vencem hoje', () => {
    it('cada um recebe o que enxerga: admin e cobrador, nunca vendedor', async () => {
      atrasos = { [id.admin]: { atrasadas: 5, hoje: 2 }, [id.cobrador]: { atrasadas: 1, hoje: 0 }, [id.vendedor]: { atrasadas: 9, hoje: 9 } }
      await servico.sincronizar()
      const a = await lista('admin')
      expect(a.itens.map((n) => n.texto).sort()).toEqual(['2 parcelas vencem hoje.', '5 parcelas atrasadas para cobrar.'])
      expect(a.itens.every((n) => n.rota === '/cobrancas')).toBe(true)
      const c = await lista('cobrador')
      expect(c.itens).toHaveLength(1)
      expect(c.itens[0]).toMatchObject({ texto: '1 parcela atrasada para cobrar.', rota: '/hoje' })
      expect((await lista('vendedor')).itens).toHaveLength(0)
    })
    it('zero não vira aviso', async () => {
      atrasos = { [id.admin]: { atrasadas: 0, hoje: 0 } }
      await servico.sincronizar()
      expect((await lista('admin')).itens).toHaveLength(0)
    })
    it('rodar de novo no mesmo dia não repete; no dia seguinte avisa de novo', async () => {
      atrasos = { [id.admin]: { atrasadas: 3, hoje: 0 } }
      await servico.sincronizar(); await servico.sincronizar()
      expect((await lista('admin')).itens).toHaveLength(1)
      dia = '2026-11-07'
      await servico.sincronizar()
      expect((await lista('admin')).itens).toHaveLength(2)
    })
  })

  describe('ler e marcar como lido', () => {
    it('o mais novo vem primeiro, e marcar atualiza o contador', async () => {
      await fato('PROPOSTA_CRIADA', 'proposta', 1, id.vendedor)
      await fato('DESCONTO_PEDIDO', 'aprovacao', 2, id.cobrador)
      await servico.sincronizar()
      const l = await lista('admin')
      expect(l.itens.map((n) => n.tipo)).toEqual(['pedido', 'pedido'])
      expect(l.itens[0].texto).toMatch(/desconto/i)
      expect(l.naoLidas).toBe(2)
      expect((await req('POST', `/api/notificacoes/${l.itens[0].id}/lida`, 'admin')).statusCode).toBe(204)
      const depois = await lista('admin')
      expect(depois.naoLidas).toBe(1)
      expect(depois.itens[0].lida).toBe(true)
    })
    it('marcar todas', async () => {
      await fato('PROPOSTA_CRIADA', 'proposta', 1, id.vendedor)
      await fato('PROPOSTA_CRIADA', 'proposta', 2, id.vendedor)
      await servico.sincronizar()
      expect((await req('POST', '/api/notificacoes/lidas', 'admin')).statusCode).toBe(204)
      expect((await lista('admin')).naoLidas).toBe(0)
      expect((await lista('admin2')).naoLidas).toBe(2) // o aviso de cada pessoa é só dela
    })
    it('ninguém mexe no aviso do outro (404) e id inválido é 400', async () => {
      await fato('PROPOSTA_CRIADA', 'proposta', 1, id.vendedor)
      await servico.sincronizar()
      const meu = (await lista('admin')).itens[0].id
      expect((await req('POST', `/api/notificacoes/${meu}/lida`, 'admin2')).statusCode).toBe(404)
      expect((await lista('admin')).naoLidas).toBe(1)
      expect((await req('POST', '/api/notificacoes/abc/lida', 'admin')).statusCode).toBe(400)
      expect((await req('POST', '/api/notificacoes/0/lida', 'admin')).statusCode).toBe(400)
    })
  })

  it('uma falha ao contar atrasos não derruba o resto', async () => {
    const quebrado = createNotificacoesService({
      repo: createNotificacoesRepository(db!), hoje: () => dia, log: () => {},
      atrasos: async () => { throw new Error('banco fora') },
    })
    await fato('PROPOSTA_CRIADA', 'proposta', 1, id.vendedor)
    await expect(quebrado.sincronizar()).resolves.toBeUndefined()
    expect((await lista('admin')).itens).toHaveLength(1)
  })
})
