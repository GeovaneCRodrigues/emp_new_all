import type { FastifyInstance } from 'fastify'
import type { Knex } from 'knex'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { createAuditoriaRepository } from '../src/modules/auditoria/models/repository.js'
import { createSessoesRepository, createUsuariosRepository } from '../src/modules/auth/models/repository.js'
import { createAuthService } from '../src/modules/auth/services/auth.service.js'
import { hashSenha } from '../src/modules/auth/services/password.js'
import { createTokensService } from '../src/modules/auth/services/tokens.js'
import { createClientesRepository } from '../src/modules/clientes/models/repository.js'
import { createClientesService } from '../src/modules/clientes/services/clientes.service.js'
import { createIndicadoresRepository } from '../src/modules/indicadores/models/repository.js'
import { createIndicadoresService } from '../src/modules/indicadores/services/indicadores.service.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()
const SENHA = 'senha-forte-123'

describe.skipIf(!db)('indicadores (Postgres de verdade)', () => {
  let app: FastifyInstance
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}

  const req = (metodo: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, papel?: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  const login = (email: string, senha: string) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha } })
  const novo = async (corpo: object) => (await req('POST', '/api/indicadores', 'admin', corpo)).json()
  const indicador = async (i: number) => (await req('GET', `/api/indicadores/${i}`, 'admin')).json()

  /** n vendas para o indicador (conta como operações trazidas) */
  async function operacoes(indicadorId: number, n: number, status = 'ATIVA') {
    const k = db!
    const [cli] = await k('clientes').insert({ nome: 'Cliente Op', fone: '11900000000' }).returning('id')
    for (let i = 0; i < n; i++) {
      const [bem] = await k('bens').insert({ modelo: 'iPhone', gb: 128, cor: 'Preto', preco_venda: 3000, data_compra: '2026-09-01' }).returning('id')
      await k('vendas').insert({ bem_id: bem.id, cliente_id: cli.id, indicador_id: indicadorId, percentual_indicador: 0.5, data_venda: '2026-10-01', valor_investido: 2000, valor_total: 3000, status })
    }
  }

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    // devolve a tabela de níveis ao padrão (os testes de níveis alteram)
    await k('niveis_indicador').update({ min_operacoes: k.raw('-1 - min_operacoes') })
    for (const [nid, min, pct] of [['BRONZE', 0, 0.3], ['PRATA', 3, 0.4], ['OURO', 5, 0.5], ['DIAMANTE', 10, 0.55]] as const) await k('niveis_indicador').where({ id: nid }).update({ min_operacoes: min, pct })
    await k('sistema_config').where({ chave: 'niveis_auto' }).update({ valor: JSON.stringify(true) })

    const hash = await hashSenha(SENHA)
    for (const [chave, perfil] of [['admin', 'ADMIN'], ['vendedor', 'VENDEDOR'], ['cobrador', 'COBRADOR']] as const) {
      const [u] = await k('users').insert({ nome: chave, email: `${chave}@t.com`, senha_hash: hash, perfil }).returning('id')
      id[chave] = u.id
    }
    const tokens = createTokensService('x'.repeat(40), '15m')
    const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
    const audit = createAuditoriaRepository(k)
    app = await buildApp({
      env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth,
      clientes: createClientesService(createClientesRepository(k), audit), usuarios: {} as never,
      indicadores: createIndicadoresService(createIndicadoresRepository(k), audit), estoque: {} as never, vendas: {} as never, config: {} as never, recebimentos: {} as never,
    })
    for (const papel of ['admin', 'vendedor', 'cobrador']) t[papel] = (await login(`${papel}@t.com`, SENHA)).json().accessToken
  })

  afterAll(async () => { await app?.close(); await db?.destroy() })

  describe('permissões', () => {
    it('só o admin gerencia indicadores e níveis (403 para os outros, 401 sem login)', async () => {
      for (const papel of ['vendedor', 'cobrador']) {
        expect((await req('GET', '/api/indicadores', papel)).statusCode).toBe(403)
        expect((await req('POST', '/api/indicadores', papel, { nome: 'X Y', pct: 0.5 })).statusCode).toBe(403)
        expect((await req('PATCH', '/api/indicadores/1', papel, { nome: 'Z Z' })).statusCode).toBe(403)
        expect((await req('POST', '/api/indicadores/1/acesso', papel, { email: 'a@b.com' })).statusCode).toBe(403)
        expect((await req('GET', '/api/niveis', papel)).statusCode).toBe(403)
        expect((await req('PUT', '/api/niveis', papel, {})).statusCode).toBe(403)
      }
      expect((await req('GET', '/api/indicadores')).statusCode).toBe(401)
    })
  })

  describe('cadastro', () => {
    it('cria com % definido à mão: fica manual, WhatsApp normalizado, nível Bronze, e audita', async () => {
      const r = await req('POST', '/api/indicadores', 'admin', { nome: '  Roberto   Indicações ', whatsapp: '(11) 98812-4410', chavePix: 'roberto@pix.com', pct: 0.5 })
      expect(r.statusCode).toBe(201)
      const i = r.json()
      expect(i).toMatchObject({ nome: 'Roberto Indicações', whatsapp: '11988124410', chavePix: 'roberto@pix.com', pct: 0.5, pctManual: true, ativo: true, operacoes: 0, temAcesso: false })
      expect(i.nivel).toMatchObject({ nome: 'Bronze' })
      expect(i.proximoNivel).toMatchObject({ nome: 'Prata' })
      expect(i.faltamParaProximo).toBe(3)
      id.roberto = i.id
      const aud = await db!('auditoria').where({ acao: 'INDICADOR_CRIADO', entidade_id: i.id }).first()
      expect(aud).toMatchObject({ usuario_id: id.admin })
    })

    it('"automático" usa o % do nível e não fica manual', async () => {
      const i = await novo({ nome: 'Loja Ponto Cell', automatico: true })
      expect(i).toMatchObject({ pct: 0.3, pctManual: false })
      id.loja = i.id
    })

    it('% e WhatsApp são opcionais; o resto da ficha vem vazio', async () => {
      const i = await novo({ nome: 'Sem Contato', pct: 0.4 })
      expect(i).toMatchObject({ whatsapp: null, chavePix: null })
    })

    it.each([
      ['sem nome', { pct: 0.5 }],
      ['nome curto', { nome: 'A', pct: 0.5 }],
      ['sem % nem automático', { nome: 'Fulano' }],
      ['% zero', { nome: 'Fulano', pct: 0 }],
      ['% acima de 100', { nome: 'Fulano', pct: 1.5 }],
      ['% como texto', { nome: 'Fulano', pct: '50' }],
      ['% e automático juntos', { nome: 'Fulano', pct: 0.5, automatico: true }],
      ['WhatsApp inválido', { nome: 'Fulano', pct: 0.5, whatsapp: '123' }],
      ['Pix enorme', { nome: 'Fulano', pct: 0.5, chavePix: 'x'.repeat(121) }],
    ])('recusa %s (400)', async (_n, corpo) => expect((await req('POST', '/api/indicadores', 'admin', corpo)).statusCode).toBe(400))
  })

  describe('lista e nível', () => {
    it('conta as operações e sobe o nível, sem contar as canceladas', async () => {
      const i = await novo({ nome: 'Quem Indica Muito', pct: 0.5 })
      await operacoes(i.id, 3)
      await operacoes(i.id, 2, 'CANCELADA')
      const lista = (await req('GET', '/api/indicadores', 'admin')).json() as { id: number; operacoes: number; nivel: { nome: string } }[]
      const x = lista.find((l) => l.id === i.id)!
      expect(x.operacoes).toBe(3)
      expect(x.nivel.nome).toBe('Prata')
      id.muito = i.id
    })

    it('lista em ordem alfabética', async () => {
      const nomes = ((await req('GET', '/api/indicadores', 'admin')).json() as { nome: string }[]).map((x) => x.nome)
      expect(nomes).toEqual([...nomes].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'pt-BR')))
    })

    it('id inexistente é 404 e inválido é 400', async () => {
      expect((await req('GET', '/api/indicadores/99999', 'admin')).statusCode).toBe(404)
      expect((await req('GET', '/api/indicadores/abc', 'admin')).statusCode).toBe(400)
    })
  })

  describe('edição do %', () => {
    it('mexer só no nome não toca no %', async () => {
      const r = await req('PATCH', `/api/indicadores/${id.roberto}`, 'admin', { nome: 'Roberto Silva' })
      expect(r.json()).toMatchObject({ nome: 'Roberto Silva', pct: 0.5, pctManual: true })
    })

    it('definir o % à mão torna manual', async () => {
      const r = await req('PATCH', `/api/indicadores/${id.loja}`, 'admin', { pct: 0.35 })
      expect(r.json()).toMatchObject({ pct: 0.35, pctManual: true })
    })

    it('voltar ao automático usa o % do nível de hoje (3 operações = Prata, 40%)', async () => {
      const r = await req('PATCH', `/api/indicadores/${id.muito}`, 'admin', { automatico: true })
      expect(r.json()).toMatchObject({ pct: 0.4, pctManual: false })
    })

    it('não aceita % e automático juntos, nem % inválido', async () => {
      expect((await req('PATCH', `/api/indicadores/${id.muito}`, 'admin', { pct: 0.5, automatico: true })).statusCode).toBe(400)
      expect((await req('PATCH', `/api/indicadores/${id.muito}`, 'admin', { pct: 2 })).statusCode).toBe(400)
    })

    it('grava o antes e o depois do % na auditoria', async () => {
      await req('PATCH', `/api/indicadores/${id.roberto}`, 'admin', { pct: 0.45 })
      const aud = await db!('auditoria').where({ acao: 'INDICADOR_ALTERADO', entidade_id: id.roberto }).orderBy('id', 'desc').first()
      expect(aud.antes.pct).toBe(0.5)
      expect(aud.depois.pct).toBe(0.45)
    })

    it('o % antigo das operações já feitas não muda', async () => {
      const [{ percentual_indicador }] = await db!('vendas').where({ indicador_id: id.muito }).limit(1)
      expect(Number(percentual_indicador)).toBe(0.5) // criada com 50% e o indicador agora está em 40%
    })
  })

  describe('níveis', () => {
    it('lista os 4 níveis e se o % sobe sozinho', async () => {
      const r = (await req('GET', '/api/niveis', 'admin')).json()
      expect(r.auto).toBe(true)
      expect(r.niveis.map((n: { nome: string }) => n.nome)).toEqual(['Bronze', 'Prata', 'Ouro', 'Diamante'])
    })

    const completo = (mudancas: Record<string, object> = {}, auto = true) => ({
      auto,
      niveis: [
        { id: 'BRONZE', minOperacoes: 0, pct: 0.3, ...mudancas.BRONZE },
        { id: 'PRATA', minOperacoes: 3, pct: 0.4, ...mudancas.PRATA },
        { id: 'OURO', minOperacoes: 5, pct: 0.5, ...mudancas.OURO },
        { id: 'DIAMANTE', minOperacoes: 10, pct: 0.55, ...mudancas.DIAMANTE },
      ],
    })

    it('mudar o % de um nível atualiza só os indicadores automáticos', async () => {
      const r = await req('PUT', '/api/niveis', 'admin', completo({ PRATA: { pct: 0.45 } }))
      expect(r.statusCode).toBe(200)
      expect((await indicador(id.muito)).pct).toBe(0.45) // automático, nível Prata
      expect((await indicador(id.roberto)).pct).toBe(0.45) // manual, ficou como o admin deixou (0,45)
      expect((await indicador(id.loja)).pct).toBe(0.35) // manual (0,35)
      expect((await indicador(id.loja)).pctManual).toBe(true)
    })

    it('com o automático desligado, os níveis não mexem em ninguém', async () => {
      await req('PUT', '/api/niveis', 'admin', completo({ PRATA: { pct: 0.42 } }, false))
      expect((await indicador(id.muito)).pct).toBe(0.45)
      expect((await req('GET', '/api/niveis', 'admin')).json().auto).toBe(false)
      await req('PUT', '/api/niveis', 'admin', completo({ PRATA: { pct: 0.4 } }, true))
      expect((await indicador(id.muito)).pct).toBe(0.4)
    })

    it('troca os mínimos sem bater na regra de unicidade', async () => {
      const r = await req('PUT', '/api/niveis', 'admin', completo({ PRATA: { minOperacoes: 4 }, OURO: { minOperacoes: 6 } }))
      expect(r.statusCode).toBe(200)
      expect(r.json().niveis.map((n: { minOperacoes: number }) => n.minOperacoes)).toEqual([0, 4, 6, 10])
      await req('PUT', '/api/niveis', 'admin', completo())
    })

    it.each([
      ['mínimo repetido', { OURO: { minOperacoes: 3 } }],
      ['nível de cima ganha menos', { PRATA: { pct: 0.2 } }],
      ['% fora do intervalo', { OURO: { pct: 1.5 } }],
      ['primeiro nível não começa em 0', { BRONZE: { minOperacoes: 1 } }],
    ])('recusa: %s (400)', async (_n, m) => expect((await req('PUT', '/api/niveis', 'admin', completo(m as Record<string, object>))).statusCode).toBe(400))

    it('recusa lista incompleta, id desconhecido e auto sem ser booleano', async () => {
      const c = completo()
      expect((await req('PUT', '/api/niveis', 'admin', { ...c, niveis: c.niveis.slice(0, 3) })).statusCode).toBe(400)
      expect((await req('PUT', '/api/niveis', 'admin', { ...c, niveis: [...c.niveis.slice(0, 3), { id: 'OUTRO', minOperacoes: 10, pct: 0.6 }] })).statusCode).toBe(400)
      expect((await req('PUT', '/api/niveis', 'admin', { ...c, auto: 'sim' })).statusCode).toBe(400)
    })
  })

  describe('acesso do indicador', () => {
    let senhaTemp = ''

    it('admin cria o acesso: a senha temporária aparece só nesta resposta e não é guardada', async () => {
      const r = await req('POST', `/api/indicadores/${id.roberto}/acesso`, 'admin', { email: 'Roberto@Indica.com' })
      expect(r.statusCode).toBe(201)
      expect(r.headers['cache-control']).toBe('no-store')
      const b = r.json()
      expect(b.email).toBe('roberto@indica.com')
      expect(b.senhaTemporaria.length).toBeGreaterThanOrEqual(10)
      senhaTemp = b.senhaTemporaria
      const u = await db!('users').where({ indicador_id: id.roberto }).first()
      expect(u).toMatchObject({ perfil: 'INDICADOR', ativo: true, senha_temporaria: true })
      expect(u.senha_hash).not.toContain(senhaTemp)
      expect((await indicador(id.roberto)).temAcesso).toBe(true)
      const aud = await db!('auditoria').where({ acao: 'INDICADOR_ACESSO_CRIADO', entidade_id: id.roberto }).first()
      expect(JSON.stringify(aud)).not.toContain(senhaTemp)
    })

    it('segundo acesso para o mesmo indicador é 409; e-mail já usado também', async () => {
      const dup = await req('POST', `/api/indicadores/${id.roberto}/acesso`, 'admin', { email: 'outro@indica.com' })
      expect(dup.statusCode).toBe(409)
      expect(dup.json().codigo).toBe('ACESSO_EXISTENTE')
      const emUso = await req('POST', `/api/indicadores/${id.loja}/acesso`, 'admin', { email: 'admin@t.com' })
      expect(emUso.statusCode).toBe(409)
      expect(emUso.json().codigo).toBe('EMAIL_EM_USO')
    })

    it('recusa e-mail inválido e indicador inexistente', async () => {
      expect((await req('POST', `/api/indicadores/${id.loja}/acesso`, 'admin', { email: 'nao-e-email' })).statusCode).toBe(400)
      expect((await req('POST', '/api/indicadores/99999/acesso', 'admin', { email: 'a@b.com' })).statusCode).toBe(404)
    })

    it('com senha temporária, o indicador só consegue trocar a senha, ver quem é e sair', async () => {
      const l = await login('roberto@indica.com', senhaTemp)
      expect(l.statusCode).toBe(200)
      expect(l.json().usuario).toMatchObject({ perfil: 'INDICADOR', precisaTrocarSenha: true })
      t.roberto = l.json().accessToken
      const bloqueado = await req('GET', '/api/clientes', 'roberto')
      expect(bloqueado.statusCode).toBe(403)
      expect(bloqueado.json().codigo).toBe('TROCAR_SENHA')
      expect((await req('GET', '/api/auth/eu', 'roberto')).statusCode).toBe(200)
    })

    it('trocou a senha: libera o acesso, e a senha temporária deixa de funcionar', async () => {
      const troca = await req('POST', '/api/auth/senha', 'roberto', { senhaAtual: senhaTemp, novaSenha: 'minha-senha-nova-123' })
      expect(troca.statusCode).toBe(204)
      expect((await req('GET', '/api/clientes', 'roberto')).statusCode).toBe(200)
      expect((await login('roberto@indica.com', senhaTemp)).statusCode).toBe(401)
      const novo = await login('roberto@indica.com', 'minha-senha-nova-123')
      expect(novo.json().usuario.precisaTrocarSenha).toBe(false)
      t.roberto = novo.json().accessToken
    })

    it('o indicador não enxerga a gestão de indicadores', async () => {
      expect((await req('GET', '/api/indicadores', 'roberto')).statusCode).toBe(403)
    })
  })

  describe('desativar', () => {
    it('desativar derruba o acesso na hora e reativar devolve', async () => {
      expect((await req('GET', '/api/auth/eu', 'roberto')).statusCode).toBe(200)
      const off = await req('PATCH', `/api/indicadores/${id.roberto}`, 'admin', { ativo: false })
      expect(off.json().ativo).toBe(false)
      expect((await req('GET', '/api/auth/eu', 'roberto')).statusCode).toBe(401) // sessão revogada
      expect((await login('roberto@indica.com', 'minha-senha-nova-123')).statusCode).toBe(401)

      const on = await req('PATCH', `/api/indicadores/${id.roberto}`, 'admin', { ativo: true })
      expect(on.json().ativo).toBe(true)
      expect((await login('roberto@indica.com', 'minha-senha-nova-123')).statusCode).toBe(200)
    })

    it('indicador desativado não ganha acesso novo', async () => {
      await req('PATCH', `/api/indicadores/${id.loja}`, 'admin', { ativo: false })
      expect((await req('POST', `/api/indicadores/${id.loja}/acesso`, 'admin', { email: 'loja@x.com' })).statusCode).toBe(400)
    })

    it('ativo precisa ser verdadeiro ou falso', async () => {
      expect((await req('PATCH', `/api/indicadores/${id.loja}`, 'admin', { ativo: 'nao' })).statusCode).toBe(400)
    })
  })
})
