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
import { createPropostasRepository } from '../src/modules/propostas/models/repository.js'
import { createPropostasService } from '../src/modules/propostas/services/propostas.service.js'
import { createVendasRepository } from '../src/modules/vendas/models/repository.js'
import { createVendasService } from '../src/modules/vendas/services/vendas.service.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()
const SENHA = 'senha-forte-123'
// CPFs válidos
const CPFS = ['52998224725', '11144477735', '39053344705', '16899535009', '86288366757', '71428793860']

describe.skipIf(!db)('cliente do indicador e proposta (Postgres de verdade)', () => {
  let app: FastifyInstance
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}
  let cpfN = 0

  const req = (metodo: 'GET' | 'POST' | 'PATCH', url: string, papel?: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  const novoCpf = () => CPFS[cpfN++ % CPFS.length]
  /** Cadastro de cliente pelo indicador (CPF novo a cada vez, para não bater no duplicado). */
  async function clienteDoIndicador(papel = 'indicador', extra: object = {}): Promise<number> {
    const r = await req('POST', '/api/clientes', papel, { nome: 'Cliente ' + cpfN, fone: '1198812' + String(4000 + cpfN), cpf: novoCpf(), ...extra })
    expect(r.statusCode, r.body).toBe(201)
    return r.json().cliente.id
  }
  const propor = (papel: string, corpo: object = {}) => req('POST', '/api/propostas', papel, { tipo: 'VENDA', interesse: 'iPhone 14 128 GB', ...corpo })
  const aceitar = (papel: string, p: number, corpo: object = {}) => req('POST', `/api/propostas/${p}/aceitar`, papel, corpo)
  const recusar = (papel: string, p: number, corpo: object = {}) => req('POST', `/api/propostas/${p}/recusar`, papel, corpo)
  const cancelar = (papel: string, p: number) => req('POST', `/api/propostas/${p}/cancelar`, papel)
  const lista = async (papel: string, q = '') => (await req('GET', `/api/propostas${q}`, papel)).json()
  /** Venda de 3.000 para o cliente, com o indicador (feita pela loja). */
  async function venda(cliente: number, indicador: number | null = id.roberto): Promise<number> {
    const [b] = await db!('bens').insert({ modelo: 'iPhone 13', gb: 128, cor: 'Preto', preco_venda: 3000, valor_compra: 2000, data_compra: '2026-09-01' }).returning('id')
    const r = await req('POST', '/api/vendas', 'admin', { aparelhoId: b.id, clienteId: cliente, preco: 3000, entrada: 600, parcelas: 4, diaVencimento: 10, ...(indicador ? { indicadorId: indicador } : {}) })
    expect(r.statusCode, r.body).toBe(201)
    return r.json().id
  }
  async function emprestimo(cliente: number, indicador: number | null = id.roberto): Promise<number> {
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
    for (const [chave, perfil, extra] of [['admin', 'ADMIN', {}], ['vendedor', 'VENDEDOR', {}], ['cobrador', 'COBRADOR', {}], ['indicador', 'INDICADOR', { indicador_id: id.roberto }], ['indicador2', 'INDICADOR', { indicador_id: id.carla }]] as const) {
      const [u] = await k('users').insert({ nome: `${chave} Silva`, email: `${chave}@t.com`, senha_hash: hash, perfil, ...extra }).returning('id')
      id[chave] = u.id
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
      vendas: createVendasService({ vendas: createVendasRepository(k), config, auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis() }),
      emprestimos: createEmprestimosService({ emprestimos: createEmprestimosRepository(k), auditoria: audit, sincronizarNiveis: () => indicadores.sincronizarNiveis() }),
      propostas: createPropostasService({ repo: createPropostasRepository(k), auditoria: audit }),
      recebimentos: {} as never, aprovacoes: {} as never, fechamentos: {} as never, equipe: {} as never,
      limites: { vendasPorMinuto: 100_000, recebimentosPorMinuto: 100_000 },
    })
    for (const papel of ['admin', 'vendedor', 'cobrador', 'indicador', 'indicador2']) t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  })
  beforeEach(async () => {
    const k = db!
    for (const tb of ['indicacoes', 'recebimentos', 'transacoes_recebimento', 'venda_parcelas', 'emprestimo_parcelas', 'vendas', 'emprestimos', 'bens', 'clientes']) await k(tb).del()
    cpfN = 0
  })
  afterAll(async () => { await app?.close(); await db?.destroy() })

  // ======================= o indicador cadastra o cliente =======================
  describe('indicador cadastra o cliente', () => {
    it('cria já vinculado a ele, sem carteira; ele vê o cliente, o outro indicador não', async () => {
      const c = await clienteDoIndicador()
      const linha = await db!('clientes').where({ id: c }).first()
      expect(linha.indicador_id).toBe(id.roberto)
      expect(linha.responsavel_id).toBeNull()
      expect((await req('GET', `/api/clientes/${c}`, 'indicador')).statusCode).toBe(200)
      expect((await req('GET', '/api/clientes', 'indicador')).json().total).toBe(1)
      expect((await req('GET', `/api/clientes/${c}`, 'indicador2')).statusCode).toBe(404)
      expect((await req('GET', '/api/clientes', 'indicador2')).json().total).toBe(0)
      expect((await req('GET', `/api/clientes/${c}`, 'admin')).json().indicadorId).toBe(id.roberto)
    })
    it('a resposta do indicador não traz CPF, RG nem endereço (só o necessário)', async () => {
      const r = await req('POST', '/api/clientes', 'indicador', { nome: 'Maria Souza', fone: '11988124410', cpf: novoCpf(), rg: '123456789', endereco: 'Rua A, 10' })
      expect(r.statusCode).toBe(201)
      expect(Object.keys(r.json().cliente).sort()).toEqual(['desde', 'fone', 'id', 'nome'])
    })
    it('CPF é obrigatório para o indicador (400), e inválido também', async () => {
      expect((await req('POST', '/api/clientes', 'indicador', { nome: 'Sem CPF', fone: '11988124410' })).statusCode).toBe(400)
      expect((await req('POST', '/api/clientes', 'indicador', { nome: 'CPF ruim', fone: '11988124410', cpf: '11111111111' })).statusCode).toBe(400)
      expect(await db!('clientes').count('* as n').first().then((l) => Number((l as { n: string }).n))).toBe(0)
    })
    it('CPF repetido: 409 sem dizer de quem é o cadastro', async () => {
      const cpf = novoCpf()
      await req('POST', '/api/clientes', 'admin', { nome: 'Cliente da Loja', fone: '11988124410', cpf })
      const r = await req('POST', '/api/clientes', 'indicador', { nome: 'Outro Nome', fone: '11977776666', cpf })
      expect(r.statusCode).toBe(409)
      expect(r.json().codigo).toBe('CPF_DUPLICADO')
      expect(r.body).not.toContain('Cliente da Loja')
    })
    it('telefone repetido de um cliente que ele não enxerga: aviso genérico, sem nome', async () => {
      await req('POST', '/api/clientes', 'admin', { nome: 'Cliente da Loja', fone: '11988124410' })
      const r = await req('POST', '/api/clientes', 'indicador', { nome: 'Novo', fone: '11988124410', cpf: novoCpf() })
      expect(r.statusCode).toBe(201)
      expect(r.json().avisos[0]).toContain('outra carteira')
      expect(JSON.stringify(r.json().avisos)).not.toContain('Cliente da Loja')
    })
    it('não dá para escolher o responsável nem outro indicador pelo corpo', async () => {
      const c = await clienteDoIndicador('indicador', { responsavelId: id.cobrador, indicadorId: id.carla })
      const linha = await db!('clientes').where({ id: c }).first()
      expect(linha.responsavel_id).toBeNull()
      expect(linha.indicador_id).toBe(id.roberto)
    })
    it('o indicador não edita cliente (403) e cobrador continua sem cadastrar (403)', async () => {
      const c = await clienteDoIndicador()
      expect((await req('PATCH', `/api/clientes/${c}`, 'indicador', { nome: 'Outro' })).statusCode).toBe(403)
      expect((await req('POST', '/api/clientes', 'cobrador', { nome: 'X Y', fone: '11988124410' })).statusCode).toBe(403)
      expect((await req('POST', '/api/clientes', undefined, { nome: 'X Y', fone: '11988124410' })).statusCode).toBe(401)
    })
    it('admin e vendedor cadastram como antes (sem vínculo de indicador)', async () => {
      const a = (await req('POST', '/api/clientes', 'admin', { nome: 'Do Admin', fone: '11988124411' })).json().cliente.id
      const v = (await req('POST', '/api/clientes', 'vendedor', { nome: 'Do Vendedor', fone: '11988124412' })).json().cliente.id
      for (const c of [a, v]) expect((await db!('clientes').where({ id: c }).first()).indicador_id).toBeNull()
    })
    it('quem tem venda com ele continua vendo o cliente (como antes), mesmo sem ter cadastrado', async () => {
      const [c] = await db!('clientes').insert({ nome: 'Da Loja', fone: '11988124410' }).returning('id')
      await venda(c.id)
      expect((await req('GET', `/api/clientes/${c.id}`, 'indicador')).statusCode).toBe(200)
      expect((await req('GET', `/api/clientes/${c.id}`, 'indicador2')).statusCode).toBe(404)
    })
  })

  // ======================= a proposta (intenção) =======================
  describe('quem pode mandar e ver', () => {
    it('só o indicador manda (403 admin, vendedor e cobrador; 401 sem login)', async () => {
      const c = await clienteDoIndicador()
      for (const papel of ['admin', 'vendedor', 'cobrador']) expect((await propor(papel, { clienteId: c })).statusCode).toBe(403)
      expect((await propor('', { clienteId: c })).statusCode).toBe(401)
      expect(await db!('indicacoes').count('* as n').first().then((l) => Number((l as { n: string }).n))).toBe(0)
    })
    it('vendedor e cobrador não leem propostas (403)', async () => {
      for (const papel of ['vendedor', 'cobrador']) expect((await req('GET', '/api/propostas', papel)).statusCode).toBe(403)
      expect((await req('GET', '/api/propostas')).statusCode).toBe(401)
    })
    it('cliente de outro indicador ou inexistente: 404 igual', async () => {
      const dela = await clienteDoIndicador('indicador2')
      const a = await propor('indicador', { clienteId: dela })
      const b = await propor('indicador', { clienteId: 999999 })
      expect([a.statusCode, b.statusCode]).toEqual([404, 404])
      expect(a.json().erro).toBe(b.json().erro)
    })
  })

  describe('criar a proposta', () => {
    it('venda com aparelho: guarda o aparelho e monta o texto do interesse', async () => {
      const c = await clienteDoIndicador()
      const [b] = await db!('bens').insert({ modelo: 'iPhone 15 Pro', gb: 256, cor: 'Titânio', preco_venda: 7000, valor_compra: 5000, data_compra: '2026-09-01' }).returning('id')
      const r = await req('POST', '/api/propostas', 'indicador', { clienteId: c, tipo: 'VENDA', aparelhoId: b.id, parcelas: 10, obs: 'quer entrada baixa' })
      expect(r.statusCode).toBe(201)
      expect(r.json()).toMatchObject({ tipo: 'VENDA', status: 'PENDENTE', interesse: 'iPhone 15 Pro 256 GB Titânio', parcelas: 10, obs: 'quer entrada baixa', indicador: { nome: 'Roberto' }, aparelho: { id: b.id, modelo: 'iPhone 15 Pro' }, operacao: null })
    })
    it('empréstimo com valor', async () => {
      const c = await clienteDoIndicador()
      const r = await req('POST', '/api/propostas', 'indicador', { clienteId: c, tipo: 'EMPRESTIMO', valor: 5000.5, parcelas: 6 })
      expect(r.statusCode).toBe(201)
      expect(r.json()).toMatchObject({ tipo: 'EMPRESTIMO', valor: 5000.5, parcelas: 6, interesse: null, aparelho: null })
    })
    it.each([
      ['sem tipo', { tipo: undefined }], ['tipo inválido', { tipo: 'TROCA' }],
      ['sem cliente', { clienteId: undefined }], ['cliente como texto', { clienteId: '1' }], ['cliente zero', { clienteId: 0 }],
      ['interesse enorme', { interesse: 'x'.repeat(161) }], ['obs enorme', { obs: 'x'.repeat(501) }], ['interesse que não é texto', { interesse: 5 }],
      ['valor zero', { valor: 0 }], ['valor negativo', { valor: -1 }], ['valor como texto', { valor: '100' }], ['valor gigante', { valor: 1e9 }],
      ['parcelas zero', { parcelas: 0 }], ['parcelas 121', { parcelas: 121 }], ['parcelas quebradas', { parcelas: 2.5 }], ['parcelas como texto', { parcelas: '10' }],
      ['aparelho inexistente', { aparelhoId: 999999 }], ['aparelho que não é número', { aparelhoId: 'a' }],
      ['nada dito (sem interesse nem valor)', { interesse: undefined }],
    ])('recusa %s (400) e não grava nada', async (_n, m) => {
      const c = await clienteDoIndicador()
      const corpo = { clienteId: c, tipo: 'VENDA', interesse: 'iPhone 14', ...m } as Record<string, unknown>
      for (const k of Object.keys(corpo)) if (corpo[k] === undefined) delete corpo[k]
      expect((await req('POST', '/api/propostas', 'indicador', corpo)).statusCode).toBe(400)
      expect(await db!('indicacoes').count('* as n').first().then((l) => Number((l as { n: string }).n))).toBe(0)
    })
    it('aparelho em proposta de empréstimo: 400', async () => {
      const c = await clienteDoIndicador()
      const [b] = await db!('bens').insert({ modelo: 'iPhone 12', gb: 64, cor: 'Azul', preco_venda: 2000, valor_compra: 1500, data_compra: '2026-09-01' }).returning('id')
      expect((await req('POST', '/api/propostas', 'indicador', { clienteId: c, tipo: 'EMPRESTIMO', aparelhoId: b.id, valor: 1000 })).statusCode).toBe(400)
    })
    it('registra na auditoria', async () => {
      const c = await clienteDoIndicador()
      await propor('indicador', { clienteId: c })
      expect(await db!('auditoria').where({ acao: 'PROPOSTA_CRIADA' }).first()).toBeTruthy()
    })
  })

  describe('listar e ver', () => {
    it('o administrador vê todas; o indicador, só as dele; pendentes primeiro; conta as pendentes', async () => {
      const a = await clienteDoIndicador('indicador'); const b = await clienteDoIndicador('indicador2')
      const p1 = (await propor('indicador', { clienteId: a })).json().id
      const p2 = (await propor('indicador2', { clienteId: b })).json().id
      const p3 = (await propor('indicador', { clienteId: a, interesse: 'iPhone 11' })).json().id
      await recusar('admin', p1)
      const todas = await lista('admin')
      expect(todas.total).toBe(3); expect(todas.pendentes).toBe(2)
      expect(todas.itens.map((p: { id: number }) => p.id)).toEqual([p3, p2, p1]) // pendentes (mais nova primeiro), depois a recusada
      const dele = await lista('indicador')
      expect(dele.itens.map((p: { id: number }) => p.id).sort()).toEqual([p1, p3].sort())
      expect(dele.itens.every((p: { indicador: { id: number } }) => p.indicador.id === id.roberto)).toBe(true)
      expect(JSON.stringify(dele)).not.toContain('Carla')
    })
    it('filtra por status e por indicador (o filtro de indicador só vale para o admin)', async () => {
      const a = await clienteDoIndicador('indicador'); const b = await clienteDoIndicador('indicador2')
      const p1 = (await propor('indicador', { clienteId: a })).json().id
      await propor('indicador2', { clienteId: b })
      await recusar('admin', p1)
      expect((await lista('admin', '?status=RECUSADA')).total).toBe(1)
      expect((await lista('admin', `?indicadorId=${id.carla}`)).total).toBe(1)
      expect((await lista('indicador', `?indicadorId=${id.carla}`)).total).toBe(1) // continua só as dele
      expect((await req('GET', '/api/propostas?status=XYZ', 'admin')).statusCode).toBe(400)
      expect((await req('GET', '/api/propostas?indicadorId=abc', 'admin')).statusCode).toBe(400)
    })
    it('a proposta de outro indicador é 404 (igual a uma que não existe)', async () => {
      const b = await clienteDoIndicador('indicador2')
      const p = (await propor('indicador2', { clienteId: b })).json().id
      expect((await req('GET', `/api/propostas/${p}`, 'indicador')).statusCode).toBe(404)
      expect((await req('GET', '/api/propostas/999999', 'indicador')).statusCode).toBe(404)
      expect((await req('GET', `/api/propostas/${p}`, 'admin')).statusCode).toBe(200)
      expect((await req('GET', '/api/propostas/abc', 'admin')).statusCode).toBe(400)
    })
  })

  describe('a loja aceita', () => {
    it('só o administrador (403 para os outros)', async () => {
      const c = await clienteDoIndicador(); const p = (await propor('indicador', { clienteId: c })).json().id
      for (const papel of ['indicador', 'vendedor', 'cobrador']) expect((await aceitar(papel, p)).statusCode).toBe(403)
      expect((await aceitar('', p)).statusCode).toBe(401)
      expect((await req('GET', `/api/propostas/${p}`, 'admin')).json().status).toBe('PENDENTE')
    })
    it('aceita sem ligar a nada: fica ACEITA com quem respondeu', async () => {
      const c = await clienteDoIndicador(); const p = (await propor('indicador', { clienteId: c })).json().id
      const r = await aceitar('admin', p)
      expect(r.statusCode).toBe(200)
      expect(r.json()).toMatchObject({ status: 'ACEITA', respondidoPor: 'admin Silva', operacao: null })
      expect(r.json().respondidoEm).toBeTruthy()
    })
    it('aceita ligando à venda que a loja cadastrou para o mesmo cliente e indicador', async () => {
      const c = await clienteDoIndicador(); const p = (await propor('indicador', { clienteId: c })).json().id
      const v = await venda(c)
      const r = await aceitar('admin', p, { vendaId: v })
      expect(r.json()).toMatchObject({ status: 'ACEITA', operacao: { tipo: 'VENDA', id: v } })
    })
    it('proposta de empréstimo liga ao empréstimo', async () => {
      const c = await clienteDoIndicador(); const p = (await propor('indicador', { clienteId: c, tipo: 'EMPRESTIMO', interesse: undefined, valor: 1000 })).json().id
      const e = await emprestimo(c)
      expect((await aceitar('admin', p, { emprestimoId: e })).json().operacao).toEqual({ tipo: 'EMPRESTIMO', id: e })
    })
    it.each([
      ['venda de outro cliente', async (c: number) => ({ vendaId: await venda((await clienteDoIndicador()) as number) })],
      ['venda com outro indicador', async (c: number) => ({ vendaId: await venda(c, id.carla) })],
      ['venda sem indicador', async (c: number) => ({ vendaId: await venda(c, null) })],
      ['empréstimo numa proposta de venda', async (c: number) => ({ emprestimoId: await emprestimo(c) })],
      ['venda inexistente', async () => ({ vendaId: 999999 })],
      ['id que não é número', async () => ({ vendaId: 'a' })],
      ['venda e empréstimo juntos', async (c: number) => ({ vendaId: await venda(c), emprestimoId: await emprestimo(c) })],
    ])('recusa ligar %s e a proposta continua pendente', async (_n, monta) => {
      const c = await clienteDoIndicador(); const p = (await propor('indicador', { clienteId: c })).json().id
      const corpo = await monta(c)
      const r = await aceitar('admin', p, corpo)
      expect([400, 404]).toContain(r.statusCode)
      expect((await req('GET', `/api/propostas/${p}`, 'admin')).json().status).toBe('PENDENTE')
    })
    it('a mesma venda não liga a duas propostas (409) e a segunda segue pendente', async () => {
      const c = await clienteDoIndicador(); const v = await venda(c)
      const p1 = (await propor('indicador', { clienteId: c })).json().id
      const p2 = (await propor('indicador', { clienteId: c, interesse: 'outro' })).json().id
      expect((await aceitar('admin', p1, { vendaId: v })).statusCode).toBe(200)
      const r = await aceitar('admin', p2, { vendaId: v })
      expect(r.statusCode).toBe(409); expect(r.json().codigo).toBe('OPERACAO_JA_LIGADA')
      expect((await req('GET', `/api/propostas/${p2}`, 'admin')).json().status).toBe('PENDENTE')
    })
    it('aceitar duas vezes: 409 PROPOSTA_JA_RESPONDIDA; inexistente 404; id inválido 400', async () => {
      const c = await clienteDoIndicador(); const p = (await propor('indicador', { clienteId: c })).json().id
      await aceitar('admin', p)
      expect((await aceitar('admin', p)).json().codigo).toBe('PROPOSTA_JA_RESPONDIDA')
      expect((await aceitar('admin', 999999)).statusCode).toBe(404)
      expect((await req('POST', '/api/propostas/abc/aceitar', 'admin')).statusCode).toBe(400)
    })
    it('aceitar e recusar ao mesmo tempo: só uma resposta vale', async () => {
      const c = await clienteDoIndicador(); const p = (await propor('indicador', { clienteId: c })).json().id
      const rs = await Promise.all([aceitar('admin', p), recusar('admin', p), aceitar('admin', p), recusar('admin', p)])
      expect(rs.filter((r) => r.statusCode === 200)).toHaveLength(1)
      expect(rs.filter((r) => r.statusCode === 409)).toHaveLength(3)
    })
  })

  describe('a loja recusa e o indicador cancela', () => {
    it('recusar guarda o motivo e o indicador o vê', async () => {
      const c = await clienteDoIndicador(); const p = (await propor('indicador', { clienteId: c })).json().id
      const r = await recusar('admin', p, { motivo: 'Cliente sem renda comprovada' })
      expect(r.json()).toMatchObject({ status: 'RECUSADA', motivoRecusa: 'Cliente sem renda comprovada' })
      expect((await req('GET', `/api/propostas/${p}`, 'indicador')).json().motivoRecusa).toBe('Cliente sem renda comprovada')
    })
    it('recusar sem motivo vale; motivo enorme é 400; só admin; já respondida 409', async () => {
      const c = await clienteDoIndicador(); const p = (await propor('indicador', { clienteId: c })).json().id
      expect((await recusar('indicador', p)).statusCode).toBe(403)
      expect((await recusar('admin', p, { motivo: 'x'.repeat(301) })).statusCode).toBe(400)
      expect((await recusar('admin', p)).json().motivoRecusa).toBeNull()
      expect((await recusar('admin', p)).statusCode).toBe(409)
    })
    it('o indicador cancela a própria pendente; a de outro é 404; admin e outros perfis 403; depois de respondida 409', async () => {
      const a = await clienteDoIndicador(); const p = (await propor('indicador', { clienteId: a })).json().id
      expect((await cancelar('indicador2', p)).statusCode).toBe(404)
      for (const papel of ['admin', 'vendedor', 'cobrador']) expect((await cancelar(papel, p)).statusCode).toBe(403)
      expect((await cancelar('indicador', p)).json().status).toBe('CANCELADA')
      expect((await cancelar('indicador', p)).statusCode).toBe(409)
      const q = (await propor('indicador', { clienteId: a })).json().id
      await aceitar('admin', q)
      expect((await cancelar('indicador', q)).json().codigo).toBe('PROPOSTA_JA_RESPONDIDA')
    })
    it('proposta cancelada não pode ser aceita nem recusada', async () => {
      const c = await clienteDoIndicador(); const p = (await propor('indicador', { clienteId: c })).json().id
      await cancelar('indicador', p)
      expect((await aceitar('admin', p)).statusCode).toBe(409)
      expect((await recusar('admin', p)).statusCode).toBe(409)
    })
    it('auditoria das respostas', async () => {
      const c = await clienteDoIndicador()
      const a = (await propor('indicador', { clienteId: c })).json().id; const b = (await propor('indicador', { clienteId: c })).json().id; const d = (await propor('indicador', { clienteId: c })).json().id
      await aceitar('admin', a); await recusar('admin', b, { motivo: 'x' }); await cancelar('indicador', d)
      for (const acao of ['PROPOSTA_ACEITA', 'PROPOSTA_RECUSADA', 'PROPOSTA_CANCELADA']) expect(await db!('auditoria').where({ acao }).first(), acao).toBeTruthy()
    })
  })
})
