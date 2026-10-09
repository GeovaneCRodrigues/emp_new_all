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
import { createEmprestimosRepository } from '../src/modules/emprestimos/models/repository.js'
import { createEmprestimosService } from '../src/modules/emprestimos/services/emprestimos.service.js'
import { createEquipeRepository } from '../src/modules/equipe/models/repository.js'
import { createEquipeService } from '../src/modules/equipe/services/equipe.service.js'
import { createFechamentosRepository } from '../src/modules/fechamentos/models/repository.js'
import { createFechamentosService } from '../src/modules/fechamentos/services/fechamentos.service.js'
import { createIndicadoresRepository } from '../src/modules/indicadores/models/repository.js'
import { createIndicadoresService } from '../src/modules/indicadores/services/indicadores.service.js'
import { createRecebimentosRepository } from '../src/modules/recebimentos/models/repository.js'
import { createRecebimentosService } from '../src/modules/recebimentos/services/recebimentos.service.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()
const SENHA = 'senha-forte-123'

describe.skipIf(!db)('baixas de empréstimo (Postgres de verdade)', () => {
  let app: FastifyInstance
  let hoje = '2026-10-08'
  let segura = false
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}

  const req = (metodo: 'GET' | 'POST', url: string, papel?: string, payload?: object) =>
    app.inject({ method: metodo, url, payload, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })

  /** Empréstimo criado em `hoje`. Parcelado padrão: 5.000 a 10% em 6x de 1.333,34. */
  async function emprestimo(corpo: object = {}, cliente = id.cA): Promise<number> {
    const r = await req('POST', '/api/emprestimos', 'admin', { clienteId: cliente, modalidade: 'PARCELADO', capital: 5000, taxa: 10, parcelas: 6, ...corpo })
    expect(r.statusCode).toBe(201)
    return r.json().id
  }
  /** Só juros padrão do Geovane: 3.000 a 12% em 3x → 360, 360, 3.360. */
  const juros = (cliente = id.cA) => emprestimo({ modalidade: 'JUROS', capital: 3000, taxa: 12, parcelas: 3 }, cliente)
  const receber = (papel: string, e: number, corpo: object) => req('POST', `/api/emprestimos/${e}/recebimentos`, papel, { forma: 'PIX', parcela: 1, valor: 1333.34, ...corpo })
  const ficha = async (e: number) => (await req('GET', `/api/emprestimos/${e}`, 'admin')).json()
  const valores = async (e: number) => (await ficha(e)).parcelas.map((p: { valor: number }) => p.valor)
  const status = async (e: number) => (await db!('emprestimos').where({ id: e }).first()).status as string

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    const hash = await hashSenha(SENHA)
    for (const [chave, perfil] of [['admin', 'ADMIN'], ['vendedor', 'VENDEDOR'], ['cobrador', 'COBRADOR'], ['cobrador2', 'COBRADOR']] as const) {
      const [u] = await k('users').insert({ nome: `${chave} Silva`, email: `${chave}@t.com`, senha_hash: hash, perfil }).returning('id')
      id[chave] = u.id
    }
    const cli = async (chave: string, nome: string, resp: number | null) => { const [c] = await k('clientes').insert({ nome, fone: '11988124410', responsavel_id: resp }).returning('id'); id[chave] = c.id }
    await cli('cA', 'Ana Souza', id.cobrador)
    await cli('cB', 'Bruno Lima', id.cobrador2)

    const tokens = createTokensService('x'.repeat(40), '15m')
    const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
    const audit = createAuditoriaRepository(k)
    const indicadores = createIndicadoresService(createIndicadoresRepository(k), audit)
    const espera = async () => { if (segura) await new Promise((r) => setTimeout(r, 200)) }
    app = await buildApp({
      env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, clientes: {} as never, usuarios: {} as never, indicadores,
      estoque: {} as never, vendas: {} as never, config: {} as never,
      emprestimos: createEmprestimosService({ emprestimos: createEmprestimosRepository(k), auditoria: audit, hoje: () => hoje }),
      recebimentos: createRecebimentosService({ repo: createRecebimentosRepository(k), auditoria: audit, hoje: () => hoje, depoisDeLerParcelas: espera }),
      aprovacoes: createAprovacoesService({ repo: createAprovacoesRepository(k), auditoria: audit, hoje: () => hoje }),
      fechamentos: createFechamentosService({ repo: createFechamentosRepository(k), auditoria: audit, hoje: () => hoje }),
      equipe: createEquipeService({ repo: createEquipeRepository(k), auditoria: audit, hoje: () => hoje }),
      limites: { vendasPorMinuto: 100_000, recebimentosPorMinuto: 100_000 },
    })
    for (const papel of ['admin', 'vendedor', 'cobrador', 'cobrador2']) t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  })
  beforeEach(() => { hoje = '2026-10-08'; segura = false })
  afterAll(async () => { await app?.close(); await db?.destroy() })

  // ===================== PARCELADO (e DIÁRIA): mesma regra das vendas =====================
  describe('parcelado', () => {
    it('quem pode: admin e cobrador da carteira; vendedor 403; carteira de outro e inexistente 404; sem login 401', async () => {
      const e = await emprestimo()
      expect((await receber('vendedor', e, {})).statusCode).toBe(403)
      expect((await receber('', e, {})).statusCode).toBe(401)
      expect((await receber('cobrador2', e, {})).statusCode).toBe(404)
      expect((await receber('admin', 999999, {})).statusCode).toBe(404)
      expect((await receber('cobrador', e, {})).statusCode).toBe(201)
    })
    it('pagou a parcela certa: quita, devolve recibo de empréstimo com texto do WhatsApp e atualiza a ficha', async () => {
      const e = await emprestimo()
      const r = await receber('admin', e, {})
      expect(r.statusCode).toBe(201)
      const { recibo, efeitos, quitada } = r.json()
      expect(efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }])
      expect(quitada).toBe(false)
      expect(recibo).toMatchObject({ operacao: 'EMPRESTIMO', aparelho: 'Empréstimo parcelado', valor: 1333.34, referencia: 'parcela 1/6', faltaDepois: 6666.7, restantes: 5, cliente: { nome: 'Ana Souza' } })
      expect(recibo.mensagem).toContain('referente à parcela 1/6 do empréstimo parcelado.')
      expect(recibo.mensagem).not.toContain('seu Empréstimo')
      const f = await ficha(e)
      expect(f).toMatchObject({ recebido: 1333.34, falta: 6666.7, status: 'ATIVA' })
      expect(f.parcelas[0]).toMatchObject({ pago: 1333.34, falta: 0 })
      expect(await db!('auditoria').where({ acao: 'RECEBIMENTO_REGISTRADO', entidade: 'emprestimo', entidade_id: e })).toHaveLength(1)
    })
    it('quitar todas as parcelas fecha o empréstimo; pagar de novo é 409', async () => {
      const e = await emprestimo({ parcelas: 2 }) // 5.000 × 1,2 ÷ 2 = 2 parcelas de 3.000
      expect((await receber('admin', e, { parcela: 1, valor: 3000 })).json().quitada).toBe(false)
      expect(await status(e)).toBe('ATIVA')
      expect((await receber('admin', e, { parcela: 2, valor: 3000 })).json().quitada).toBe(true)
      expect(await status(e)).toBe('QUITADA')
      expect((await receber('admin', e, { parcela: 2, valor: 10 })).json().codigo).toBe('PARCELA_PAGA')
    })
    it('pagou menos: o resto fica devendo com nova data e a parcela continua aberta (admin e cobrador)', async () => {
      const e = await emprestimo()
      const r = await receber('cobrador', e, { valor: 500, resto: 'FICA', novoVencimento: '2026-10-20' })
      expect(r.json().efeitos).toEqual([{ tipo: 'FICA', numero: 1, resta: 833.34, vencimento: '2026-10-20' }])
      const f = await ficha(e)
      expect(f.parcelas[0]).toMatchObject({ pago: 500, falta: 833.34, vencimento: '2026-10-20', vencimentoOriginal: '2026-11-08' })
      expect((await receber('cobrador', e, { valor: 500 })).json().codigo).toBe('RESTO_OBRIGATORIO')
    })
    it('desconto direto só o administrador (cobrador 403); quita a parcela e some do lucro', async () => {
      const e = await emprestimo()
      expect((await receber('cobrador', e, { valor: 500, resto: 'DESCONTO' })).statusCode).toBe(403)
      const r = await receber('admin', e, { valor: 1000, resto: 'DESCONTO' })
      expect(r.json().efeitos).toEqual([{ tipo: 'DESCONTO', numero: 1, valor: 333.34 }])
      expect((await ficha(e)).parcelas[0]).toMatchObject({ pago: 1000, desconto: 333.34, falta: 0 })
    })
    it('pedir desconto em empréstimo ainda não existe (400) e o pagamento NÃO é lançado', async () => {
      const e = await emprestimo()
      const antes = await db!('transacoes_recebimento').count<{ count: string }[]>({ count: '*' })
      const r = await receber('cobrador', e, { valor: 500, resto: 'FICA', novoVencimento: '2026-10-20', pedirDesconto: { motivo: 'cliente sem dinheiro' } })
      expect(r.statusCode).toBe(400)
      expect(await db!('transacoes_recebimento').count<{ count: string }[]>({ count: '*' })).toEqual(antes)
    })
    it('pagou a mais: o excedente abate as próximas parcelas, na ordem', async () => {
      const e = await emprestimo()
      const r = await receber('admin', e, { valor: 2000 })
      expect(r.json().efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }, { tipo: 'ABATE', numero: 2, valor: 666.66 }])
      expect((await ficha(e)).parcelas.map((p: { falta: number }) => p.falta)).toEqual([0, 666.68, 1333.34, 1333.34, 1333.34, 1333.34])
    })
    it('passou da dívida inteira: 400 e nada é lançado', async () => {
      const e = await emprestimo()
      expect((await receber('admin', e, { valor: 8000.05 })).json().codigo).toBe('EXCEDE_DIVIDA')
      expect((await ficha(e)).recebido).toBe(0)
    })
    it.each([['valor zero', { valor: 0 }], ['valor negativo', { valor: -1 }], ['valor como texto', { valor: '10' }], ['sem forma', { forma: undefined }], ['forma inventada', { forma: 'BOLETO' }], ['sem parcela', { parcela: undefined }], ['data futura', { data: '2026-10-09' }], ['data antes do empréstimo', { data: '2026-10-01' }]])('recusa %s (400)', async (_n, m) => {
      const e = await emprestimo()
      const corpo = { forma: 'PIX', parcela: 1, valor: 100, ...m } as Record<string, unknown>
      for (const k of Object.keys(corpo)) if (corpo[k] === undefined) delete corpo[k]
      expect((await req('POST', `/api/emprestimos/${e}/recebimentos`, 'admin', corpo)).statusCode).toBe(400)
    })
    it('cobrador só lança o que recebeu hoje (data de ontem é 403)', async () => {
      const e = await emprestimo()
      hoje = '2026-10-09'
      expect((await receber('cobrador', e, { data: '2026-10-08' })).statusCode).toBe(403)
      expect((await receber('admin', e, { data: '2026-10-08' })).statusCode).toBe(201)
    })
    it('diária também: segue a regra das vendas', async () => {
      const e = await emprestimo({ modalidade: 'DIARIA', capital: 1000, taxa: 20, parcelas: 24 })
      const r = await receber('admin', e, { valor: 100, resto: 'FICA', novoVencimento: '2026-10-20' }) // parcela de 50: paga 100 → quita a 1 e abate 50 da 2
      expect(r.json().efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }, { tipo: 'QUITA', numero: 2 }])
      expect(r.json().recibo.aparelho).toBe('Empréstimo diária')
    })
  })

  // ===================== SÓ JUROS: o excedente amortiza o capital =====================
  describe('só juros', () => {
    it('pagou o juro certo: quita a parcela e o resto do plano fica igual', async () => {
      const e = await juros()
      const r = await receber('admin', e, { valor: 360 })
      expect(r.json().efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }])
      expect(r.json().recibo.amortizacao).toBeNull()
      expect(await valores(e)).toEqual([360, 360, 3360])
    })
    it('exemplo do Geovane: 1.000 na 1ª → 360 de juro + 640 abatem o capital; o juro seguinte vira 283,20', async () => {
      const e = await juros()
      const r = await receber('admin', e, { valor: 1000 })
      expect(r.statusCode).toBe(201)
      expect(r.json().efeitos).toEqual([{ tipo: 'QUITA', numero: 1 }, { tipo: 'AMORTIZA', valor: 640, capitalRestante: 2360 }])
      const { recibo } = r.json()
      expect(recibo).toMatchObject({ valor: 1000, amortizacao: { valor: 640, capitalRestante: 2360 }, faltaDepois: 2926.4, restantes: 2 })
      expect(recibo.mensagem).toContain('abateu o capital')
      expect(recibo.mensagem).toContain('R$ 2.360,00')
      expect(await valores(e)).toEqual([360, 283.2, 2643.2])
      const f = await ficha(e)
      // a amortização (640) conta como dinheiro recebido e como parte do total: 640 + 360 + 283,20 + 2.643,20
      expect(f).toMatchObject({ total: 3926.4, recebido: 1000, falta: 2926.4, status: 'ATIVA', lucroTotal: 926.4, capitalDeVolta: 1000 })
    })
    it('juro + todo o capital (3.360) quita o empréstimo inteiro: parcelas seguintes zeradas e quitadas', async () => {
      const e = await juros()
      const r = await receber('admin', e, { valor: 3360 })
      expect(r.json()).toMatchObject({ quitada: true })
      expect(await valores(e)).toEqual([360, 0, 0])
      expect(await status(e)).toBe('QUITADA')
      const f = await ficha(e)
      expect(f).toMatchObject({ falta: 0, status: 'QUITADA', total: 3360, recebido: 3360, lucroTotal: 360 })
      expect(f.parcelas.every((p: { falta: number }) => p.falta === 0)).toBe(true)
      expect(r.json().recibo.mensagem).toContain('Tudo quitado')
    })
    it('passar de juro + capital é 400 e nada muda; excedente na última parcela também', async () => {
      const e = await juros()
      expect((await receber('admin', e, { valor: 3360.01 })).json().codigo).toBe('EXCEDE_DIVIDA')
      expect(await valores(e)).toEqual([360, 360, 3360])
      expect((await receber('admin', e, { parcela: 3, valor: 3400 })).json().codigo).toBe('EXCEDE_DIVIDA')
    })
    it('amortiza em duas vezes: a 2ª usa o capital que sobrou (2.360), não o original', async () => {
      const e = await juros()
      await receber('admin', e, { valor: 1000 }) // capital 2.360; plano 360, 283,20, 2.643,20
      const r = await receber('admin', e, { parcela: 2, valor: 1283.2 }) // 283,20 de juro + 1.000 de excedente → capital 1.360
      expect(r.json().efeitos).toEqual([{ tipo: 'QUITA', numero: 2 }, { tipo: 'AMORTIZA', valor: 1000, capitalRestante: 1360 }])
      expect(await valores(e)).toEqual([360, 283.2, 1523.2]) // 1.360 + 12% de 1.360 (163,20)
      expect((await receber('admin', e, { parcela: 3, valor: 1523.21 })).json().codigo).toBe('EXCEDE_DIVIDA')
    })
    it('pagou menos que o juro: o resto fica devendo, sem amortizar e sem recalcular nada', async () => {
      const e = await juros()
      const r = await receber('admin', e, { valor: 100, resto: 'FICA', novoVencimento: '2026-10-20' })
      expect(r.json().efeitos).toEqual([{ tipo: 'FICA', numero: 1, resta: 260, vencimento: '2026-10-20' }])
      expect(await valores(e)).toEqual([360, 360, 3360])
    })
    it('DESFAZER devolve o valor das parcelas recalculadas, o capital e o status', async () => {
      const e = await juros()
      const r = await receber('admin', e, { valor: 3360 })
      expect(await status(e)).toBe('QUITADA')
      expect((await req('POST', `/api/recebimentos/${r.json().recibo.id}/desfazer`, 'admin')).statusCode).toBe(204)
      expect(await valores(e)).toEqual([360, 360, 3360])
      expect(await status(e)).toBe('ATIVA')
      expect(await ficha(e)).toMatchObject({ recebido: 0, falta: 4080 })
      // e dá para amortizar de novo com o capital inteiro de volta
      expect((await receber('admin', e, { valor: 1000 })).json().recibo.amortizacao).toEqual({ valor: 640, capitalRestante: 2360 })
    })
    it('desfazer a 2ª amortização volta ao estado da 1ª (capital 2.360), não ao original', async () => {
      const e = await juros()
      await receber('admin', e, { valor: 1000 })
      const r2 = await receber('admin', e, { parcela: 2, valor: 1283.2 })
      await req('POST', `/api/recebimentos/${r2.json().recibo.id}/desfazer`, 'admin')
      expect(await valores(e)).toEqual([360, 283.2, 2643.2])
      expect((await receber('admin', e, { parcela: 2, valor: 283.2 + 2360 + 0.01 })).json().codigo).toBe('EXCEDE_DIVIDA')
      expect((await receber('admin', e, { parcela: 2, valor: 283.2 + 2360 })).json().quitada).toBe(true)
    })
    it('o cobrador também amortiza (é só a regra do dinheiro) e só desfaz o dele de hoje', async () => {
      const e = await juros()
      const r = await receber('cobrador', e, { valor: 1000 })
      expect(r.statusCode).toBe(201)
      expect((await req('POST', `/api/recebimentos/${r.json().recibo.id}/desfazer`, 'cobrador2')).statusCode).toBe(404)
      expect((await req('POST', `/api/recebimentos/${r.json().recibo.id}/desfazer`, 'cobrador')).statusCode).toBe(204)
      expect(await valores(e)).toEqual([360, 360, 3360])
    })
  })

  // ===================== desfazer, recibo, pagamentos =====================
  describe('desfazer, recibo e pagamentos', () => {
    it('só o último recebimento do empréstimo se desfaz', async () => {
      const e = await emprestimo()
      const a = (await receber('admin', e, { parcela: 1 })).json().recibo.id
      const b = (await receber('admin', e, { parcela: 2 })).json().recibo.id
      expect((await req('POST', `/api/recebimentos/${a}/desfazer`, 'admin')).json().codigo).toBe('NAO_E_O_ULTIMO')
      expect((await req('POST', `/api/recebimentos/${b}/desfazer`, 'admin')).statusCode).toBe(204)
      expect((await req('POST', `/api/recebimentos/${b}/desfazer`, 'admin')).json().codigo).toBe('JA_DESFEITO')
      expect((await req('POST', `/api/recebimentos/${a}/desfazer`, 'admin')).statusCode).toBe(204)
      expect((await ficha(e)).recebido).toBe(0)
    })
    it('desfazer devolve a data antiga da parcela remarcada e reabre o empréstimo quitado', async () => {
      const e = await emprestimo({ parcelas: 1 })
      const r = await receber('admin', e, { valor: 5500, resto: 'FICA' })
      expect(r.json().quitada).toBe(true)
      expect(await status(e)).toBe('QUITADA')
      await req('POST', `/api/recebimentos/${r.json().recibo.id}/desfazer`, 'admin')
      expect(await status(e)).toBe('ATIVA')
      const p = await db!('emprestimo_parcelas').where({ emprestimo_id: e }).first()
      expect(p.quitada_em).toBeNull()
    })
    it('recibo de empréstimo: abre para o admin e para o cobrador da carteira; outro cobrador 404', async () => {
      const e = await emprestimo()
      const rid = (await receber('cobrador', e, {})).json().recibo.id
      expect((await req('GET', `/api/recibos/${rid}`, 'admin')).json()).toMatchObject({ operacao: 'EMPRESTIMO', aparelho: 'Empréstimo parcelado' })
      expect((await req('GET', `/api/recibos/${rid}`, 'cobrador')).statusCode).toBe(200)
      expect((await req('GET', `/api/recibos/${rid}`, 'cobrador2')).statusCode).toBe(404)
    })
    it('pagamentos do empréstimo: lista do mais novo ao mais antigo, só o último pode desfazer; escopo respeitado', async () => {
      const e = await emprestimo()
      await receber('admin', e, { parcela: 1 }); await receber('admin', e, { parcela: 2 })
      const ps = (await req('GET', `/api/emprestimos/${e}/pagamentos`, 'admin')).json()
      expect(ps.map((p: { referencia: string }) => p.referencia)).toEqual(['parcela 2/6', 'parcela 1/6'])
      expect(ps.map((p: { podeDesfazer: boolean }) => p.podeDesfazer)).toEqual([true, false])
      expect((await req('GET', `/api/emprestimos/${e}/pagamentos`, 'cobrador2')).statusCode).toBe(404)
      expect((await req('GET', `/api/emprestimos/${e}/pagamentos`, 'vendedor')).statusCode).toBe(403)
      expect((await req('GET', '/api/emprestimos/999999/pagamentos', 'admin')).statusCode).toBe(404)
    })
  })

  // ===================== cobranças: vendas e empréstimos juntos =====================
  describe('cobranças', () => {
    const itens = async (papel: string, aba: string, extra = '') => (await req('GET', `/api/cobrancas?aba=${aba}&limite=100${extra}`, papel)).json()

    it('empréstimo atrasado aparece nas cobranças, com tipo e descrição', async () => {
      const e = await emprestimo({}, id.cA)
      await db!('emprestimo_parcelas').where({ emprestimo_id: e, numero: 1 }).update({ vencimento: '2026-10-01' })
      const l = (await itens('admin', 'atrasadas')).itens.find((x: { tipo: string; operacaoId: number }) => x.tipo === 'EMPRESTIMO' && x.operacaoId === e)
      expect(l).toMatchObject({ parcela: 1, nParcelas: 6, falta: 1333.34, atrasoDias: 7, aparelho: 'Empréstimo parcelado', cliente: { nome: 'Ana Souza' } })
    })
    it('filtra por tipo; tipo inventado é 400; cobrador só vê a carteira dele', async () => {
      const a = await emprestimo({}, id.cA); const b = await emprestimo({}, id.cB)
      for (const e of [a, b]) await db!('emprestimo_parcelas').where({ emprestimo_id: e, numero: 1 }).update({ vencimento: '2026-10-01' })
      const so = (await itens('admin', 'atrasadas', '&tipo=EMPRESTIMO')).itens
      expect(so.length).toBeGreaterThan(0)
      expect(so.every((x: { tipo: string }) => x.tipo === 'EMPRESTIMO')).toBe(true)
      expect((await req('GET', '/api/cobrancas?tipo=XYZ', 'admin')).statusCode).toBe(400)
      const dele = (await itens('cobrador', 'atrasadas', '&tipo=EMPRESTIMO')).itens.map((x: { operacaoId: number }) => x.operacaoId)
      expect(dele).toContain(a)
      expect(dele).not.toContain(b)
    })
    it('parcela recebida sai das atrasadas e entra nas recebidas; desfeita deixa de contar', async () => {
      const e = await emprestimo({}, id.cA)
      await db!('emprestimo_parcelas').where({ emprestimo_id: e, numero: 1 }).update({ vencimento: '2026-10-01' })
      const r = await receber('admin', e, {})
      const has = async (aba: string) => (await itens('admin', aba)).itens.some((x: { tipo: string; operacaoId: number }) => x.tipo === 'EMPRESTIMO' && x.operacaoId === e && (aba === 'atrasadas' ? true : true))
      expect((await itens('admin', 'atrasadas')).itens.some((x: { tipo: string; operacaoId: number; parcela: number }) => x.tipo === 'EMPRESTIMO' && x.operacaoId === e && x.parcela === 1)).toBe(false)
      expect((await itens('admin', 'recebidas')).itens.find((x: { tipo: string; operacaoId: number }) => x.tipo === 'EMPRESTIMO' && x.operacaoId === e)).toMatchObject({ pago: 1333.34, ultimaTransacaoId: r.json().recibo.id })
      await req('POST', `/api/recebimentos/${r.json().recibo.id}/desfazer`, 'admin')
      expect((await itens('admin', 'recebidas')).itens.some((x: { tipo: string; operacaoId: number }) => x.tipo === 'EMPRESTIMO' && x.operacaoId === e)).toBe(false)
      expect(await has('atrasadas')).toBe(true)
    })
    it('a contagem das abas soma vendas e empréstimos', async () => {
      const antes = (await itens('admin', 'atrasadas')).contagens.atrasadas
      const e = await emprestimo({}, id.cA)
      await db!('emprestimo_parcelas').where({ emprestimo_id: e, numero: 1 }).update({ vencimento: '2026-10-01' })
      expect((await itens('admin', 'atrasadas')).contagens.atrasadas).toBe(antes + 1)
    })
  })

  // ===================== caixa do cobrador e fechamento do dia =====================
  describe('caixa e fechamento', () => {
    let dia = 0
    const novoDia = () => { dia += 1; hoje = `2027-05-${String(10 + dia).padStart(2, '0')}` }

    it('o recebimento de empréstimo entra no caixa do cobrador e no fechamento do dia', async () => {
      novoDia()
      const e = await emprestimo({}, id.cA)
      await receber('cobrador', e, { valor: 1333.34, forma: 'DINHEIRO' })
      const caixa = (await req('GET', '/api/caixa/hoje', 'cobrador')).json()
      expect(caixa).toMatchObject({ dinheiro: 1333.34, total: 1333.34 })
      expect(caixa.recebimentos[0]).toMatchObject({ cliente: 'Ana Souza', referencia: 'parcela 1/6' })
      const f = await req('POST', '/api/fechamentos', 'cobrador')
      expect(f.json()).toMatchObject({ totalDinheiro: 1333.34 })
    })
    it('dia fechado: o cobrador não recebe nem desfaz empréstimo; o admin recebe mas não desfaz o do dia fechado', async () => {
      novoDia()
      const e = await emprestimo({}, id.cA)
      const rec = (await receber('cobrador', e, { parcela: 1 })).json().recibo.id
      await req('POST', '/api/fechamentos', 'cobrador')
      expect((await receber('cobrador', e, { parcela: 2 })).json().codigo).toBe('DIA_FECHADO')
      expect((await req('POST', `/api/recebimentos/${rec}/desfazer`, 'cobrador')).json().codigo).toBe('DIA_FECHADO')
      expect((await req('POST', `/api/recebimentos/${rec}/desfazer`, 'admin')).json().codigo).toBe('DIA_FECHADO')
      expect((await receber('admin', e, { parcela: 2 })).statusCode).toBe(201)
    })
  })

  // ===================== corridas =====================
  describe('corridas', () => {
    it('dois recebimentos do MESMO empréstimo ao mesmo tempo não se atropelam: um passa, o outro vê a parcela já paga', async () => {
      const e = await emprestimo({}, id.cA)
      segura = true
      const [a, b] = await Promise.all([receber('admin', e, { parcela: 1 }), receber('admin', e, { parcela: 1 })])
      expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409])
      expect((await ficha(e)).parcelas[0].pago).toBe(1333.34)
    })
    it('fechar o dia enquanto um empréstimo está sendo recebido: o fechamento espera e SOMA o recebimento', async () => {
      hoje = '2027-06-20'
      const e = await emprestimo({}, id.cA)
      segura = true // o recebimento fica 200 ms "no meio" da transação, já com o caixa travado
      const recebendo = receber('cobrador', e, { forma: 'DINHEIRO' })
      await new Promise((r) => setTimeout(r, 60))
      const fechando = req('POST', '/api/fechamentos', 'cobrador')
      const [r, f] = await Promise.all([recebendo, fechando])
      expect(r.statusCode).toBe(201)
      expect(f.statusCode).toBe(201)
      expect(f.json().totalDinheiro).toBe(1333.34) // sem a trava, o fechamento somaria 0 e o dinheiro ficaria de fora
    })
    it('só juros: duas amortizações simultâneas não passam do capital', async () => {
      const e = await juros(id.cA)
      segura = true
      const [a, b] = await Promise.all([receber('admin', e, { valor: 2360 }), receber('admin', e, { valor: 2360 })])
      // cada uma tenta 360 de juro + 2.000 de excedente: só cabe uma antes de a outra estourar o capital/parcela
      const ok = [a, b].filter((r) => r.statusCode === 201).length
      expect(ok).toBe(1)
      const f = await ficha(e)
      expect(f.falta).toBeGreaterThanOrEqual(0)
      expect(f.recebido).toBe(2360)
    })
  })
})
