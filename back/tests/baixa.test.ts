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

describe.skipIf(!db)('o indicador avisa que recebeu e a loja confirma (Postgres de verdade)', () => {
  let app: FastifyInstance
  let hoje = '2026-10-08'
  /** Segura a transação depois de ler as parcelas, para forçar duas confirmações a se sobreporem de verdade. */
  let segura = false
  const espera = async () => { if (segura) await new Promise((r) => setTimeout(r, 250)) }
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}

  const req = (metodo: 'GET' | 'POST', url: string, papel?: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  /** Venda de 3.000 (entrada 600, 4x de 840 vencendo dia 10) do cliente da Ana, com o indicador Roberto. */
  async function venda(indicador: number | null = id.roberto): Promise<number> {
    const [b] = await db!('bens').insert({ modelo: 'iPhone 13', gb: 128, cor: 'Preto', preco_venda: 3000, valor_compra: 2000, data_compra: '2026-09-01' }).returning('id')
    const r = await req('POST', '/api/vendas', 'admin', { aparelhoId: b.id, clienteId: id.ana, preco: 3000, entrada: 600, parcelas: 4, diaVencimento: 10, ...(indicador ? { indicadorId: indicador } : {}) })
    expect(r.statusCode, r.body).toBe(201)
    return r.json().id
  }
  async function emprestimo(): Promise<number> {
    const r = await req('POST', '/api/emprestimos', 'admin', { clienteId: id.ana, modalidade: 'PARCELADO', capital: 1000, taxa: 30, parcelas: 2, indicadorId: id.roberto })
    expect(r.statusCode, r.body).toBe(201)
    return r.json().id
  }
  const avisar = (papel: string, op: number, corpo: object = {}) => req('POST', '/api/aprovacoes', papel, { tipo: 'BAIXA', alvo: 'VENDA', operacaoId: op, parcela: 1, valor: 840, forma: 'PIX', ...corpo })
  const confirmar = (papel: string, pedido: number, corpo: object = {}) => req('POST', `/api/aprovacoes/${pedido}/aprovar`, papel, corpo)
  const recusar = (papel: string, pedido: number, corpo: object = {}) => req('POST', `/api/aprovacoes/${pedido}/recusar`, papel, corpo)
  const parcelas = async (v: number) => (await db!('venda_parcelas').where({ venda_id: v }).orderBy('numero')).map((p: Record<string, unknown>) => ({ n: p.numero as number, desconto: Number(p.desconto) }))
  const nRecebimentos = async () => Number((await db!('recebimentos').count('* as n').first() as { n: string }).n)
  const cobranca = async (papel: string, aba = 'proximas') => (await req('GET', `/api/cobrancas?aba=${aba}&limite=100`, papel)).json()

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    await k('sistema_config').where({ chave: 'juros_parcela_pct' }).update({ valor: JSON.stringify(10) })
    await k('sistema_config').where({ chave: 'max_parcelas' }).update({ valor: JSON.stringify(10) })
    const hash = await hashSenha(SENHA)
    for (const [chave, nome] of [['roberto', 'Roberto'], ['carla', 'Carla']] as const) { const [i] = await k('indicadores').insert({ nome, pct: 0.5, pct_manual: true }).returning('id'); id[chave] = i.id }
    for (const [chave, perfil, extra] of [['admin', 'ADMIN', {}], ['cobrador', 'COBRADOR', {}], ['vendedor', 'VENDEDOR', {}], ['indicador', 'INDICADOR', { indicador_id: id.roberto }], ['indicador2', 'INDICADOR', { indicador_id: id.carla }]] as const) {
      const [u] = await k('users').insert({ nome: `${chave} Silva`, email: `${chave}@t.com`, senha_hash: hash, perfil, ...extra }).returning('id'); id[chave] = u.id
    }
    const [c] = await k('clientes').insert({ nome: 'Ana Souza', fone: '11988124410' }).returning('id'); id.ana = c.id

    const tokens = createTokensService('x'.repeat(40), '15m')
    const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
    const audit = createAuditoriaRepository(k)
    const indicadores = createIndicadoresService(createIndicadoresRepository(k), audit)
    const config = createConfigRepository(k)
    const recebimentos = createRecebimentosService({ repo: createRecebimentosRepository(k), auditoria: audit, hoje: () => hoje, depoisDeLerParcelas: espera })
    app = await buildApp({
      env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, usuarios: {} as never, indicadores,
      clientes: {} as never,
      estoque: createEstoqueService(createEstoqueRepository(k), audit), config: createConfigService(config),
      vendas: createVendasService({ vendas: createVendasRepository(k), config, auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis(), hoje: () => hoje }),
      emprestimos: createEmprestimosService({ emprestimos: createEmprestimosRepository(k), auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis(), hoje: () => hoje }),
      recebimentos,
      aprovacoes: createAprovacoesService({ repo: createAprovacoesRepository(k), auditoria: audit, hoje: () => hoje, baixas: { confirmar: (s, pid, e) => recebimentos.confirmarBaixa(s, pid, e) } }),
      fechamentos: {} as never, equipe: {} as never,
      limites: { vendasPorMinuto: 100_000, recebimentosPorMinuto: 100_000 },
    })
    for (const papel of ['admin', 'cobrador', 'vendedor', 'indicador', 'indicador2']) t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  })
  beforeEach(async () => {
    hoje = '2026-10-08'; segura = false
    for (const tb of ['aprovacoes', 'recebimentos', 'transacoes_recebimento', 'venda_parcelas', 'emprestimo_parcelas', 'vendas', 'emprestimos', 'bens']) await db!(tb).del()
  })
  afterAll(async () => { await app?.close(); await db?.destroy() })

  describe('o indicador avisa', () => {
    it('só o indicador avisa (403 admin, cobrador e vendedor; 401 sem login)', async () => {
      const v = await venda()
      for (const papel of ['admin', 'cobrador', 'vendedor']) expect((await avisar(papel, v)).statusCode).toBe(403)
      expect((await avisar('', v)).statusCode).toBe(401)
      expect(await db!('aprovacoes').count('* as n').first().then((l) => Number((l as { n: string }).n))).toBe(0)
    })
    it('o aviso nasce PENDENTE com tudo o que a loja precisa ver, NÃO dá baixa e a parcela aparece "esperando a loja"', async () => {
      const v = await venda(); const n0 = await nRecebimentos()
      const r = await avisar('indicador', v, { comprovante: 'E2E123', motivo: 'paguei na mão dele' })
      expect(r.statusCode).toBe(201)
      expect(r.json()).toMatchObject({ tipo: 'BAIXA', status: 'PENDENTE', alvo: 'VENDA', operacaoId: v, parcela: 1, valor: 840, solicitante: { nome: 'indicador Silva' }, cliente: { nome: 'Ana Souza' }, baixa: { forma: 'PIX', data: '2026-10-08', comprovante: 'E2E123' }, motivo: 'paguei na mão dele' })
      expect(await nRecebimentos()).toBe(n0) // nada de dinheiro registrado
      expect((await parcelas(v))[0]).toMatchObject({ desconto: 0 })
      const linha = (await cobranca('indicador')).itens.find((l: { parcela: number; tipo: string }) => l.tipo === 'VENDA' && l.parcela === 1)
      expect(linha.baixaPendente).toMatchObject({ valor: 840, por: 'indicador Silva' })
      expect(linha.falta).toBe(840) // continua em aberto
      expect((await cobranca('admin')).itens.find((l: { parcela: number }) => l.parcela === 1).baixaPendente.por).toBe('indicador Silva')
    })
    it('de operação de outro indicador, sem indicador ou inexistente: 404 e nada é criado', async () => {
      const dela = await venda(id.carla); const semInd = await venda(null)
      for (const outra of [dela, semInd, 999999]) expect((await avisar('indicador', outra)).statusCode).toBe(404)
      expect(await db!('aprovacoes').count('* as n').first().then((l) => Number((l as { n: string }).n))).toBe(0)
    })
    it.each([
      ['sem valor', { valor: undefined }], ['valor zero', { valor: 0 }], ['valor negativo', { valor: -1 }], ['valor como texto', { valor: '840' }], ['valor gigante', { valor: 1e9 }],
      ['acima do que falta na parcela', { valor: 840.01 }],
      ['sem forma', { forma: undefined }], ['forma inválida', { forma: 'BOLETO' }],
      ['sem parcela', { parcela: undefined }], ['parcela zero', { parcela: 0 }], ['parcela inexistente', { parcela: 9 }],
      ['data inválida', { data: '2026-02-31' }], ['data futura', { data: '2026-10-09' }], ['data como número', { data: 20261008 }],
      ['comprovante enorme', { comprovante: 'x'.repeat(121) }], ['observação enorme', { motivo: 'x'.repeat(501) }],
      ['alvo inválido', { alvo: 'TROCA' }],
    ])('recusa %s (400/404) e não grava nada', async (_n, m) => {
      const v = await venda()
      const corpo = { tipo: 'BAIXA', alvo: 'VENDA', operacaoId: v, parcela: 1, valor: 840, forma: 'PIX', ...m } as Record<string, unknown>
      for (const k of Object.keys(corpo)) if (corpo[k] === undefined) delete corpo[k]
      const r = await req('POST', '/api/aprovacoes', 'indicador', corpo)
      expect([400, 404]).toContain(r.statusCode)
      expect(await db!('aprovacoes').count('* as n').first().then((l) => Number((l as { n: string }).n))).toBe(0)
    })
    it('parcela já paga: 409; um aviso esperando por parcela: o segundo é 409 PEDIDO_JA_EXISTE', async () => {
      const v = await venda()
      expect((await avisar('indicador', v)).statusCode).toBe(201)
      const r = await avisar('indicador', v, { valor: 100 })
      expect(r.statusCode).toBe(409); expect(r.json().codigo).toBe('PEDIDO_JA_EXISTE')
      await db!('venda_parcelas').where({ venda_id: v, numero: 2 }).update({ desconto: 840 })
      expect((await avisar('indicador', v, { parcela: 2 })).json().codigo).toBe('PARCELA_PAGA')
    })
    it('venda retomada ou cancelada não recebe aviso (409)', async () => {
      const v = await venda(); await db!('vendas').where({ id: v }).update({ status: 'RETOMADA' })
      expect((await avisar('indicador', v)).json().codigo).toBe('VENDA_ENCERRADA')
    })
    it('vale para empréstimo também', async () => {
      const e = await emprestimo()
      const r = await avisar('indicador', e, { alvo: 'EMPRESTIMO', valor: 650 })
      expect(r.statusCode).toBe(201); expect(r.json()).toMatchObject({ alvo: 'EMPRESTIMO', operacaoId: e, valor: 650 })
    })
    it('o indicador vê os próprios avisos (e o status), e só eles; o admin vê todos', async () => {
      const a = await venda(); const b = await venda(id.carla)
      await avisar('indicador', a); await avisar('indicador2', b)
      const dele = (await req('GET', '/api/aprovacoes?limite=100', 'indicador')).json()
      expect(dele.total).toBe(1); expect(dele.itens[0].operacaoId).toBe(a)
      expect((await req('GET', '/api/aprovacoes?limite=100', 'admin')).json().total).toBe(2)
    })
    it('o indicador não aprova nem recusa (403), nem o aviso de outro', async () => {
      const v = await venda(); const pid = (await avisar('indicador', v)).json().id
      for (const papel of ['indicador', 'indicador2', 'cobrador', 'vendedor']) {
        expect((await confirmar(papel, pid)).statusCode).toBe(403)
        expect((await recusar(papel, pid)).statusCode).toBe(403)
      }
      expect((await db!('aprovacoes').where({ id: pid }).first()).status).toBe('PENDENTE')
    })
  })

  describe('a loja confirma', () => {
    it('CONFIRMAR registra o recebimento (recebido pelo indicador), quita a parcela, gera o recibo e fecha o aviso', async () => {
      const v = await venda(); const pid = (await avisar('indicador', v)).json().id
      const r = await confirmar('admin', pid)
      expect(r.statusCode).toBe(200)
      expect(r.json()).toMatchObject({ id: pid, status: 'APROVADO', respondidoPor: 'admin Silva' })
      expect(r.json().recibo).toMatchObject({ valor: 840, forma: 'PIX', data: '2026-10-08' })
      const [p1] = await db!('venda_parcelas').where({ venda_id: v, numero: 1 })
      expect(p1.quitada_em).toBeTruthy()
      const t1 = await db!('transacoes_recebimento').orderBy('id', 'desc').first()
      expect(t1.recebido_por).toBe(id.indicador)
      expect(Number(t1.valor_total)).toBe(840)
      const linha = (await cobranca('admin', 'proximas')).itens.find((l: { parcela: number }) => l.parcela === 1)
      expect(linha).toBeUndefined() // saiu das próximas: está paga
      expect((await cobranca('admin', 'recebidas')).itens.find((l: { parcela: number }) => l.parcela === 1)).toBeTruthy()
    })
    it('a data que o indicador informou vale (ele recebeu antes), e o recibo sai com ela', async () => {
      const v = await venda(); hoje = '2026-10-20'
      const pid = (await avisar('indicador', v, { data: '2026-10-15' })).json().id
      expect((await confirmar('admin', pid)).json().recibo.data).toBe('2026-10-15')
    })
    it('só o administrador confirma; confirmar duas vezes: 409 e não paga em dobro', async () => {
      const v = await venda(); const pid = (await avisar('indicador', v)).json().id
      const n0 = await nRecebimentos()
      expect((await confirmar('admin', pid)).statusCode).toBe(200)
      const r = await confirmar('admin', pid)
      expect(r.statusCode).toBe(409); expect(r.json().codigo).toBe('PEDIDO_JA_RESPONDIDO')
      expect(await nRecebimentos()).toBe(n0 + 1)
    })
    it('confirmar e recusar ao mesmo tempo: só uma resposta vale, e sem recebimento duplicado', async () => {
      const v = await venda(); const pid = (await avisar('indicador', v)).json().id
      const n0 = await nRecebimentos()
      const rs = await Promise.all([confirmar('admin', pid), recusar('admin', pid), confirmar('admin', pid), recusar('admin', pid)])
      expect(rs.filter((r) => r.statusCode === 200)).toHaveLength(1)
      expect(rs.filter((r) => r.statusCode === 409)).toHaveLength(3)
      const final = (await db!('aprovacoes').where({ id: pid }).first()).status
      expect(await nRecebimentos()).toBe(final === 'APROVADO' ? n0 + 1 : n0)
    })
    it('duas confirmações sobrepostas de verdade: só uma vira recebimento (nunca em dobro)', async () => {
      const v = await venda(); const pid = (await avisar('indicador', v)).json().id
      const n0 = await nRecebimentos()
      segura = true
      const rs = await Promise.all([confirmar('admin', pid), confirmar('admin', pid), confirmar('admin', pid)])
      segura = false
      expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409, 409])
      expect(await nRecebimentos()).toBe(n0 + 1)
      expect(Number((await db!('transacoes_recebimento').count('* as n').first() as { n: string }).n)).toBe(2) // a entrada da venda + esta baixa
    })
    it('veio menos que a parcela: a loja escolhe (fica devendo, com a data nova); sem escolher, 400 e nada muda', async () => {
      const v = await venda(); const pid = (await avisar('indicador', v, { valor: 500 })).json().id
      const sem = await confirmar('admin', pid)
      expect(sem.statusCode).toBe(400)
      expect((await db!('aprovacoes').where({ id: pid }).first()).status).toBe('PENDENTE') // o aviso segue esperando
      const com = await confirmar('admin', pid, { resto: 'FICA', novoVencimento: '2026-10-25' })
      expect(com.statusCode).toBe(200)
      expect(com.json().recibo.valor).toBe(500)
      const [p1] = await db!('venda_parcelas').where({ venda_id: v, numero: 1 })
      expect(p1.vencimento_original).toBeTruthy()
    })
    it('a parcela foi paga por outro caminho antes: o aviso é recusado sozinho (não fica pendente para sempre)', async () => {
      const v = await venda(); const pid = (await avisar('indicador', v)).json().id
      expect((await req('POST', `/api/vendas/${v}/recebimentos`, 'admin', { forma: 'DINHEIRO', parcela: 1, valor: 840 })).statusCode).toBe(201)
      const a = await db!('aprovacoes').where({ id: pid }).first()
      expect(a.status).toBe('RECUSADO'); expect(a.resposta).toContain('já lançou')
      expect((await confirmar('admin', pid)).statusCode).toBe(409)
    })
    it('confirmar empréstimo registra o recebimento no empréstimo', async () => {
      const e = await emprestimo(); const pid = (await avisar('indicador', e, { alvo: 'EMPRESTIMO', valor: 650 })).json().id
      const r = await confirmar('admin', pid)
      expect(r.statusCode).toBe(200)
      expect(r.json().recibo.valor).toBe(650)
    })
    it('aviso inexistente 404; id inválido 400; aviso que não é baixa segue o caminho normal', async () => {
      expect((await confirmar('admin', 999999)).statusCode).toBe(404)
      expect((await req('POST', '/api/aprovacoes/abc/aprovar', 'admin')).statusCode).toBe(400)
    })
    it('registra na auditoria o aviso e a confirmação', async () => {
      const v = await venda(); const pid = (await avisar('indicador', v)).json().id
      await confirmar('admin', pid)
      for (const acao of ['BAIXA_AVISADA', 'BAIXA_CONFIRMADA', 'RECEBIMENTO_REGISTRADO']) expect(await db!('auditoria').where({ acao }).first(), acao).toBeTruthy()
      expect((await db!('auditoria').where({ acao: 'RECEBIMENTO_REGISTRADO' }).first()).usuario_id).toBe(id.admin) // quem fez foi a loja
    })
  })

  describe('a loja recusa', () => {
    it('RECUSAR volta a parcela a ficar em aberto, sem recebimento, e o indicador vê o motivo', async () => {
      const v = await venda(); const pid = (await avisar('indicador', v)).json().id
      const n0 = await nRecebimentos()
      const r = await recusar('admin', pid, { motivo: 'O cliente disse que não pagou' })
      expect(r.json()).toMatchObject({ status: 'RECUSADO', resposta: 'O cliente disse que não pagou' })
      expect(await nRecebimentos()).toBe(n0)
      const linha = (await cobranca('indicador')).itens.find((l: { parcela: number }) => l.parcela === 1)
      expect(linha.baixaPendente).toBeNull(); expect(linha.falta).toBe(840)
      expect((await req('GET', `/api/aprovacoes?limite=100`, 'indicador')).json().itens[0].resposta).toBe('O cliente disse que não pagou')
    })
    it('depois de recusado, o indicador pode avisar de novo', async () => {
      const v = await venda(); const pid = (await avisar('indicador', v)).json().id
      await recusar('admin', pid)
      expect((await avisar('indicador', v)).statusCode).toBe(201)
    })
  })

  describe('o indicador pede desconto (igual ao cobrador)', () => {
    it('pede desconto de uma parcela de operação dele; de outra, 404; e a loja aprova ou recusa', async () => {
      const v = await venda(); const dela = await venda(id.carla)
      const ok = await req('POST', '/api/aprovacoes', 'indicador', { alvo: 'VENDA', operacaoId: v, parcela: 1, valor: 100, motivo: 'cliente pediu um desconto' })
      expect(ok.statusCode).toBe(201); expect(ok.json().tipo).toBe('DESCONTO')
      expect((await req('POST', '/api/aprovacoes', 'indicador', { alvo: 'VENDA', operacaoId: dela, parcela: 1, valor: 100, motivo: 'abc' })).statusCode).toBe(404)
      expect((await confirmar('admin', ok.json().id)).statusCode).toBe(200)
      expect((await parcelas(v))[0].desconto).toBe(100)
    })
    it('retomada e acordo continuam só do cobrador (403 para o indicador)', async () => {
      const v = await venda()
      expect((await req('POST', '/api/aprovacoes', 'indicador', { tipo: 'RETOMADA', operacaoId: v, motivo: 'abc' })).statusCode).toBe(403)
      expect((await req('POST', '/api/aprovacoes', 'indicador', { tipo: 'ACORDO', operacaoId: v, motivo: 'abc', valorTotal: 100, parcelas: 2, primeiraParcela: '2026-11-01' })).statusCode).toBe(403)
    })
  })
})
