import type { FastifyInstance } from 'fastify'
import type { Knex } from 'knex'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()
const SENHA = 'senha-forte-123'
const HOJE = '2026-10-15'

describe.skipIf(!db)('cronograma: o calendário do mês (Postgres de verdade)', () => {
  let app: FastifyInstance
  const t: Record<string, string> = {}
  const id: Record<string, number> = {}
  const req = (url: string, papel?: string) => app.inject({ method: 'GET', url, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
  const cron = async (q: string, papel = 'admin') => (await req(`/api/cronograma${q}`, papel)).json() as { mes: string; hoje: string; cortado: boolean; itens: { tipo: string; operacaoId: number; parcela: number; vencimento: string; valor: number; pago: number; falta: number; atrasoDias: number; indicador: string | null; cliente: { id: number; nome: string } }[] }
  const chave = (r: Awaited<ReturnType<typeof cron>>) => r.itens.map((i) => `${i.tipo[0]}${i.operacaoId}.${i.parcela}@${i.vencimento.slice(5)}`)

  async function venda(clienteId: number, indicadorId: number | null, parcelas: [string, number][], status = 'ATIVA'): Promise<{ id: number; parcelaIds: number[] }> {
    const [b] = await db!('bens').insert({ modelo: 'IPHONE 13', gb: 128, cor: 'PRETO', preco_venda: 3000, valor_compra: 2000, data_compra: '2026-01-01' }).returning('id')
    const [v] = await db!('vendas').insert({ bem_id: b.id, cliente_id: clienteId, indicador_id: indicadorId, percentual_indicador: indicadorId ? 0.5 : 0, data_venda: '2026-01-10', valor_investido: 2000, valor_total: 3000, preco_acordado: 3000, status }).returning('id')
    const ids: number[] = []
    for (const [i, [vencimento, valor]] of parcelas.entries()) { const [p] = await db!('venda_parcelas').insert({ venda_id: v.id, numero: i + 1, vencimento, valor }).returning('id'); ids.push(p.id) }
    return { id: v.id, parcelaIds: ids }
  }
  async function emprestimo(clienteId: number, indicadorId: number | null, parcelas: [string, number][], status = 'ATIVA', modalidade = 'PARCELADO'): Promise<{ id: number; parcelaIds: number[] }> {
    const [e] = await db!('emprestimos').insert({ cliente_id: clienteId, indicador_id: indicadorId, percentual_indicador: indicadorId ? 0.5 : 0, data_emprestimo: '2026-01-10', capital: 1000, modalidade, taxa: 30, periodicidade: modalidade === 'DIARIA' ? 'DIARIA' : 'MENSAL', status }).returning('id')
    const ids: number[] = []
    for (const [i, [vencimento, valor]] of parcelas.entries()) { const [p] = await db!('emprestimo_parcelas').insert({ emprestimo_id: e.id, numero: i + 1, vencimento, valor }).returning('id'); ids.push(p.id) }
    return { id: e.id, parcelaIds: ids }
  }
  /** Um recibo que pagou `valor` da parcela (de venda ou de empréstimo); `desfeito` simula o desfazer. */
  async function pagar(alvo: 'V' | 'E', parcelaId: number, clienteId: number, valor: number, desfeito = false) {
    const [tr] = await db!('transacoes_recebimento').insert({ numero_recibo: Math.floor(Math.random() * 1e9), cliente_id: clienteId, valor_total: valor, forma_pagamento: 'PIX', data_recebimento: '2026-10-02', desfeita_em: desfeito ? new Date() : null }).returning('id')
    await db!('recebimentos').insert({ transacao_id: tr.id, tipo: 'PARCELA', [alvo === 'V' ? 'venda_parcela_id' : 'emprestimo_parcela_id']: parcelaId, valor })
  }

  const ref: Record<string, { id: number; parcelaIds: number[] }> = {}

  beforeAll(async () => {
    const k = db!
    await limparBanco(k)
    const hash = await hashSenha(SENHA)
    const [ind] = await k('indicadores').insert({ nome: 'Roberto', pct: 0.5 }).returning('id')
    const [ind2] = await k('indicadores').insert({ nome: 'Outro', pct: 0.5 }).returning('id')
    for (const [c, perfil, extra] of [['admin', 'ADMIN', {}], ['vendedor', 'VENDEDOR', {}], ['cobrador', 'COBRADOR', {}], ['cobrador2', 'COBRADOR', {}], ['indicador', 'INDICADOR', { indicador_id: ind.id }]] as const) {
      const [u] = await k('users').insert({ nome: `${c} Silva`, email: `${c}@t.com`, senha_hash: hash, perfil, ...extra }).returning('id'); id[c] = u.id
    }
    const cli = async (c: string, nome: string, resp: number) => { const [r] = await k('clientes').insert({ nome, fone: '11988124410', responsavel_id: resp }).returning('id'); id[c] = r.id }
    await cli('ana', 'José Conceição', id.cobrador)
    await cli('bruno', 'Bruno Lima', id.cobrador2)

    // venda da Ana (indicador Roberto): 30/09 (fora), 01/10 paga, 10/10 em aberto atrasada, 20/10 paga pela metade, 31/10 em aberto, 01/11 (fora)
    ref.vAna = await venda(id.ana, ind.id, [['2026-09-30', 100], ['2026-10-01', 200], ['2026-10-10', 300], ['2026-10-20', 400], ['2026-10-31', 500], ['2026-11-01', 600]])
    await pagar('V', ref.vAna.parcelaIds[1], id.ana, 200)
    await pagar('V', ref.vAna.parcelaIds[3], id.ana, 150)
    await pagar('V', ref.vAna.parcelaIds[2], id.ana, 300, true) // recibo desfeito: a parcela continua em aberto
    // empréstimo do Bruno (indicador Outro): 15/10 e 15/11
    ref.eBruno = await emprestimo(id.bruno, ind2.id, [['2026-10-15', 700], ['2026-11-15', 700]])
    // empréstimo da Ana (sem indicador): 05/10
    ref.eAna = await emprestimo(id.ana, null, [['2026-10-05', 50]])
    // operações que não contam: venda cancelada e retomada, empréstimo cancelado
    await venda(id.ana, ind.id, [['2026-10-12', 900]], 'CANCELADA')
    await venda(id.ana, ind.id, [['2026-10-12', 901]], 'RETOMADA')
    await emprestimo(id.ana, ind.id, [['2026-10-12', 902]], 'CANCELADA')

    const tokens = createTokensService('x'.repeat(40), '15m')
    const auth = createAuthService(createUsuariosRepository(k), createSessoesRepository(k), tokens)
    const audit = createAuditoriaRepository(k)
    const indicadores = createIndicadoresService(createIndicadoresRepository(k), audit)
    app = await buildApp({
      env: { NODE_ENV: 'test', CORS_ORIGIN: [] }, db: { ping: async () => {} }, tokens, auth, clientes: {} as never, usuarios: {} as never, indicadores,
      estoque: createEstoqueService(createEstoqueRepository(k), audit), config: createConfigService(createConfigRepository(k)), vendas: {} as never,
      recebimentos: createRecebimentosService({ repo: createRecebimentosRepository(k), auditoria: audit, hoje: () => HOJE }),
      aprovacoes: {} as never, fechamentos: {} as never, equipe: {} as never, limites: { vendasPorMinuto: 100_000, recebimentosPorMinuto: 100_000 },
    })
    for (const papel of ['admin', 'vendedor', 'cobrador', 'cobrador2', 'indicador']) t[papel] = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${papel}@t.com`, senha: SENHA } })).json().accessToken
  })
  afterAll(async () => { await app?.close(); await db?.destroy() })

  const V = () => ref.vAna.id, EB = () => ref.eBruno.id, EA = () => ref.eAna.id

  it('traz só as parcelas que vencem no mês, em ordem de data, pagas e em aberto', async () => {
    const r = await cron('?mes=2026-10')
    expect(r.mes).toBe('2026-10'); expect(r.hoje).toBe(HOJE); expect(r.cortado).toBe(false)
    expect(chave(r)).toEqual([`E${EA()}.1@10-05`, `V${V()}.2@10-01`, `V${V()}.3@10-10`, `E${EB()}.1@10-15`, `V${V()}.4@10-20`, `V${V()}.5@10-31`].sort((a, b) => a.split('@')[1].localeCompare(b.split('@')[1])))
  })

  it('o dia 1º e o último dia entram; 30 do mês anterior e 1º do seguinte ficam de fora', async () => {
    const r = await cron('?mes=2026-10')
    const dias = r.itens.map((i) => i.vencimento)
    expect(dias).toContain('2026-10-01'); expect(dias).toContain('2026-10-31'); expect(dias).not.toContain('2026-09-30'); expect(dias).not.toContain('2026-11-01')
    expect(chave(await cron('?mes=2026-09'))).toEqual([`V${V()}.1@09-30`]); expect(chave(await cron('?mes=2026-11'))).toEqual([`V${V()}.6@11-01`, `E${EB()}.2@11-15`])
  })

  it('sem mês, usa o mês de hoje', async () => { expect((await cron('')).mes).toBe('2026-10') })

  it('mostra quanto foi pago e quanto falta, e há atraso só no que está aberto e vencido', async () => {
    const m = new Map((await cron('?mes=2026-10')).itens.map((i) => [`${i.tipo[0]}.${i.parcela}.${i.operacaoId}`, i]))
    expect(m.get(`V.2.${V()}`)).toMatchObject({ valor: 200, pago: 200, falta: 0, atrasoDias: 0 }) // paga
    expect(m.get(`V.3.${V()}`)).toMatchObject({ valor: 300, pago: 0, falta: 300, atrasoDias: 5 }) // recibo desfeito: aberta e vencida em 10/10
    expect(m.get(`V.4.${V()}`)).toMatchObject({ valor: 400, pago: 150, falta: 250, atrasoDias: 0 }) // pela metade, ainda não venceu
    expect(m.get(`V.5.${V()}`)).toMatchObject({ pago: 0, falta: 500, atrasoDias: 0 })
    expect(m.get(`E.1.${EB()}`)).toMatchObject({ valor: 700, falta: 700, atrasoDias: 0 }) // vence hoje: não é atraso
    expect(m.get(`E.1.${EA()}`)).toMatchObject({ falta: 50, atrasoDias: 10 })
  })

  it('operação cancelada ou retomada não aparece', async () => {
    const r = await cron('?mes=2026-10')
    expect(r.itens.some((i) => [900, 901, 902].includes(i.valor))).toBe(false)
  })

  it('filtra por tipo', async () => {
    expect((await cron('?mes=2026-10&tipo=VENDA')).itens.every((i) => i.tipo === 'VENDA')).toBe(true)
    expect((await cron('?mes=2026-10&tipo=EMPRESTIMO')).itens.map((i) => i.tipo)).toEqual(['EMPRESTIMO', 'EMPRESTIMO'])
  })

  it('busca pelo nome do cliente, ignorando acento e maiúscula', async () => {
    for (const b of ['jose', 'JOSÉ', 'conceicao', 'ceição']) { const r = await cron(`?mes=2026-10&busca=${encodeURIComponent(b)}`); expect(r.itens.length, b).toBe(5); expect(r.itens.every((i) => i.cliente.nome === 'José Conceição')).toBe(true) }
    expect((await cron('?mes=2026-10&busca=bruno')).itens.map((i) => i.cliente.nome)).toEqual(['Bruno Lima'])
    expect((await cron('?mes=2026-10&busca=zzz')).itens).toEqual([])
    expect((await cron(`?mes=2026-10&busca=${encodeURIComponent('%')}`)).itens).toEqual([]) // % não vira curinga
  })

  describe('filtros de indicador e modalidade', () => {
    const ref2: Record<string, number> = {}
    let roberto = 0, outro = 0
    beforeAll(async () => {
      roberto = (await db!('indicadores').where({ nome: 'Roberto' }).first()).id; outro = (await db!('indicadores').where({ nome: 'Outro' }).first()).id
      ref2.parc = (await emprestimo(id.ana, roberto, [['2026-12-03', 100]])).id
      ref2.juros = (await emprestimo(id.ana, outro, [['2026-12-04', 200]], 'ATIVA', 'JUROS')).id
      ref2.dia = (await emprestimo(id.bruno, null, [['2026-12-05', 300]], 'ATIVA', 'DIARIA')).id
      ref2.venda = (await venda(id.bruno, roberto, [['2026-12-06', 400]])).id
    })
    const ids = async (q: string) => (await cron(`?mes=2026-12${q}`)).itens.map((i) => `${i.tipo[0]}${i.operacaoId}`).sort()
    const todos = () => [`E${ref2.parc}`, `E${ref2.juros}`, `E${ref2.dia}`, `V${ref2.venda}`].sort()
    it('sem filtro traz tudo; modalidade traz só empréstimos daquela modalidade', async () => {
      expect(await ids('')).toEqual(todos())
      expect(await ids('&modalidade=PARCELADO')).toEqual([`E${ref2.parc}`])
      expect(await ids('&modalidade=JUROS')).toEqual([`E${ref2.juros}`])
      expect(await ids('&modalidade=DIARIA')).toEqual([`E${ref2.dia}`])
    })
    it('várias modalidades juntas (multisseleção), na ordem que vier e sem repetir', async () => {
      expect(await ids('&modalidade=JUROS,DIARIA')).toEqual([`E${ref2.juros}`, `E${ref2.dia}`].sort())
      expect(await ids('&modalidade=DIARIA,PARCELADO,JUROS')).toEqual([`E${ref2.parc}`, `E${ref2.juros}`, `E${ref2.dia}`].sort())
      expect(await ids('&modalidade=JUROS,JUROS')).toEqual([`E${ref2.juros}`])
      expect(await ids(`&modalidade=PARCELADO,DIARIA&indicador=${roberto}`)).toEqual([`E${ref2.parc}`])
    })
    it('indicador: um deles, ou SEM para a venda direta', async () => {
      expect(await ids(`&indicador=${roberto}`)).toEqual([`E${ref2.parc}`, `V${ref2.venda}`].sort())
      expect(await ids(`&indicador=${outro}`)).toEqual([`E${ref2.juros}`])
      expect(await ids('&indicador=SEM')).toEqual([`E${ref2.dia}`])
    })
    it('os filtros somam entre si, com o tipo e com a busca', async () => {
      expect(await ids(`&indicador=${roberto}&modalidade=PARCELADO`)).toEqual([`E${ref2.parc}`])
      expect(await ids(`&indicador=${outro}&modalidade=PARCELADO`)).toEqual([])
      expect(await ids(`&indicador=${roberto}&tipo=VENDA`)).toEqual([`V${ref2.venda}`])
      expect(await ids('&modalidade=JUROS&tipo=VENDA')).toEqual([])
      expect(await ids(`&indicador=${roberto}&busca=bruno`)).toEqual([`V${ref2.venda}`])
    })
    it('situação: só o que falta receber, só o que já foi recebido, e soma com os outros filtros', async () => {
      await pagar('E', (await db!('emprestimo_parcelas').where({ emprestimo_id: ref2.juros }).first()).id, id.ana, 200) // quita a do só juros
      expect(await ids('&situacao=RECEBIDAS')).toEqual([`E${ref2.juros}`])
      expect(await ids('&situacao=ABERTAS')).toEqual([`E${ref2.parc}`, `E${ref2.dia}`, `V${ref2.venda}`].sort())
      expect(await ids('&situacao=ABERTAS&modalidade=JUROS')).toEqual([])
      expect(await ids(`&situacao=ABERTAS&indicador=${roberto}`)).toEqual([`E${ref2.parc}`, `V${ref2.venda}`].sort())
    })
    it('o cobrador filtra só dentro da carteira dele', async () => {
      const r = (await cron(`?mes=2026-12&indicador=${roberto}`, 'cobrador2')).itens.map((i) => `${i.tipo[0]}${i.operacaoId}`)
      expect(r).toEqual([`V${ref2.venda}`])
    })
    it('valor inválido → 400', async () => {
      for (const q of ['indicador=abc', 'indicador=0', 'indicador=-1', 'indicador=1.5', 'indicador=', 'modalidade=XYZ', 'modalidade=parcelado', 'modalidade=', 'situacao=abertas', 'situacao=', 'situacao=XYZ', 'modalidade=JUROS,', 'modalidade=JUROS,XYZ', 'modalidade=PARCELADO,JUROS,DIARIA,JUROS']) expect((await req(`/api/cronograma?mes=2026-12&${q}`, 'admin')).statusCode, q).toBe(400)
    })
  })

  describe('editar o vencimento de uma parcela em aberto (remarcar)', () => {
    const patch = (url: string, papel: string | undefined, corpo: object) => app.inject({ method: 'PATCH', url, payload: corpo, headers: papel ? { authorization: `Bearer ${t[papel]}` } : {} })
    const remarcarE = (e: number, n: number, corpo: object, papel: string | undefined = 'admin') => patch(`/api/emprestimos/${e}/parcelas/${n}/vencimento`, papel, corpo)
    const doMes = async (mes: string, alvo: string) => (await cron(`?mes=${mes}`)).itens.filter((i) => `${i.tipo[0]}${i.operacaoId}` === alvo).map((i) => ({ n: i.parcela, venc: i.vencimento, orig: (i as unknown as { vencimentoOriginal: string | null }).vencimentoOriginal }))
    it('muda o vencimento, guarda a data original e a parcela aparece na nova data', async () => {
      const e = await emprestimo(id.ana, null, [['2027-02-05', 100], ['2027-03-05', 100]])
      const r = await remarcarE(e.id, 1, { vencimento: '2027-02-20', motivo: 'Cliente combinou pagar dia 20' })
      expect(r.statusCode).toBe(200)
      expect(r.json()).toEqual({ parcela: 1, vencimento: '2027-02-20', vencimentoOriginal: '2027-02-05' })
      expect(await doMes('2027-02', `E${e.id}`)).toEqual([{ n: 1, venc: '2027-02-20', orig: '2027-02-05' }])
      expect(await doMes('2027-03', `E${e.id}`)).toEqual([{ n: 2, venc: '2027-03-05', orig: null }]) // a outra não mexe
      const log = await db!('auditoria').where({ acao: 'VENCIMENTO_ALTERADO', entidade: 'emprestimo', entidade_id: e.id }).first()
      expect(log.antes).toMatchObject({ parcela: 1, vencimento: '2027-02-05' }); expect(log.depois).toMatchObject({ vencimento: '2027-02-20', motivo: 'Cliente combinou pagar dia 20' })
    })
    it('remarcar de novo mantém a data ORIGINAL; voltar para ela tira a marca de remarcada', async () => {
      const e = await emprestimo(id.ana, null, [['2027-04-05', 100]])
      await remarcarE(e.id, 1, { vencimento: '2027-04-10' })
      expect((await remarcarE(e.id, 1, { vencimento: '2027-04-25' })).json()).toMatchObject({ vencimento: '2027-04-25', vencimentoOriginal: '2027-04-05' })
      expect((await remarcarE(e.id, 1, { vencimento: '2027-04-05' })).json()).toMatchObject({ vencimento: '2027-04-05', vencimentoOriginal: null })
    })
    it('atrasada que ganha data futura sai das atrasadas', async () => {
      const e = await emprestimo(id.ana, null, [['2026-09-01', 80]])
      const atrasadas = async () => (await req('/api/cobrancas?aba=atrasadas&limite=100', 'admin')).json().itens.some((i: { tipo: string; operacaoId: number }) => i.tipo === 'EMPRESTIMO' && i.operacaoId === e.id)
      expect(await atrasadas()).toBe(true)
      await remarcarE(e.id, 1, { vencimento: '2026-11-30' })
      expect(await atrasadas()).toBe(false)
    })
    it('venda de iPhone também', async () => {
      const v = await venda(id.ana, null, [['2027-05-05', 300]])
      const r = await patch(`/api/vendas/${v.id}/parcelas/1/vencimento`, 'admin', { vencimento: '2027-05-18' })
      expect(r.json()).toEqual({ parcela: 1, vencimento: '2027-05-18', vencimentoOriginal: '2027-05-05' })
    })
    it('validações: data passada, formato, mais de um ano, mesma data, motivo enorme, parcela e operação inexistentes', async () => {
      const e = await emprestimo(id.ana, null, [['2027-06-05', 100]])
      for (const corpo of [{}, { vencimento: '' }, { vencimento: '20/06/2027' }, { vencimento: '2027-02-30' }, { vencimento: '2026-10-14' }, { vencimento: '2027-12-31' }, { vencimento: '2027-06-05' }, { vencimento: '2027-06-10', motivo: 'x'.repeat(501) }, { vencimento: 20270610 }]) {
        expect((await remarcarE(e.id, 1, corpo)).statusCode, JSON.stringify(corpo)).toBe(400)
      }
      expect((await remarcarE(e.id, 9, { vencimento: '2027-06-10' })).statusCode).toBe(404)
      expect((await remarcarE(e.id, 0, { vencimento: '2027-06-10' })).statusCode).toBe(400)
      expect((await remarcarE(999999, 1, { vencimento: '2027-06-10' })).statusCode).toBe(404)
    })
    it('parcela paga → 409; paga pela metade ainda dá', async () => {
      const e = await emprestimo(id.ana, null, [['2027-07-05', 100], ['2027-08-05', 100]])
      await pagar('E', e.parcelaIds[0], id.ana, 100); await pagar('E', e.parcelaIds[1], id.ana, 40)
      const r = await remarcarE(e.id, 1, { vencimento: '2027-07-20' })
      expect(r.statusCode).toBe(409); expect(r.json().codigo).toBe('PARCELA_PAGA')
      expect((await remarcarE(e.id, 2, { vencimento: '2027-08-20' })).statusCode).toBe(200)
    })
    it('empréstimo cancelado → 409', async () => {
      const e = await emprestimo(id.ana, null, [['2027-09-05', 100]], 'CANCELADA')
      expect((await remarcarE(e.id, 1, { vencimento: '2027-09-20' })).json().codigo).toBe('VENDA_ENCERRADA')
    })
    it('só o administrador; sem login 401', async () => {
      const e = await emprestimo(id.ana, null, [['2027-10-05', 100]])
      for (const papel of ['cobrador', 'vendedor', 'indicador']) expect((await remarcarE(e.id, 1, { vencimento: '2027-10-20' }, papel)).statusCode, papel).toBe(403)
      expect((await remarcarE(e.id, 1, { vencimento: '2027-10-20' }, '')).statusCode).toBe(401)
      expect((await doMes('2027-10', `E${e.id}`))[0].venc).toBe('2027-10-05') // nada mudou
    })
  })

  describe('o nome do indicador (cronograma e cobranças)', () => {
    const cobr = async (q: string, papel = 'admin') => (await req(`/api/cobrancas?${q}`, papel)).json() as { itens: { tipo: string; operacaoId: number; parcela: number; indicador: string | null; cliente: { nome: string } }[]; total: number }
    it('cada parcela traz o indicador da operação, e null na venda direta', async () => {
      const m = new Map((await cron('?mes=2026-10')).itens.map((i) => [`${i.tipo[0]}.${i.operacaoId}`, i.indicador]))
      expect(m.get(`V.${V()}`)).toBe('Roberto'); expect(m.get(`E.${EB()}`)).toBe('Outro'); expect(m.get(`E.${EA()}`)).toBeNull()
      const c = await cobr('aba=atrasadas&limite=100')
      expect(c.itens.map((i) => `${i.tipo[0]}.${i.operacaoId}.${i.parcela}=${i.indicador}`).sort()).toEqual([`E.${EA()}.1=null`, `V.${V()}.1=Roberto`, `V.${V()}.3=Roberto`].sort()) // a venda tem a parcela de 30/09 e a de 10/10 em aberto
    })
    it('filtro de indicador nas cobranças: um indicador, "SEM", e as contagens das abas acompanham; valor inválido é 400', async () => {
      const ind = (await db!('indicadores').where({ nome: 'Roberto' }).first()).id
      const todas = await cobr('aba=atrasadas&limite=100')
      const dele = await cobr(`aba=atrasadas&limite=100&indicador=${ind}`)
      expect(dele.itens.length).toBeGreaterThan(0); expect(dele.itens.length).toBeLessThan(todas.itens.length)
      expect(dele.itens.every((i) => i.indicador === 'Roberto')).toBe(true)
      const sem = await cobr('aba=atrasadas&limite=100&indicador=SEM')
      expect(sem.itens.every((i) => i.indicador === null)).toBe(true)
      expect(dele.total + sem.total).toBeLessThanOrEqual(todas.total)
      const conts = (await (await req(`/api/cobrancas?aba=atrasadas&indicador=${ind}`, 'admin')).json()).contagens
      expect(conts.atrasadas).toBe(dele.total)
      for (const q of ['indicador=abc', 'indicador=0', 'indicador=-1', 'indicador=1.5']) expect((await req(`/api/cobrancas?${q}`, 'admin')).statusCode).toBe(400)
    })
    it('o cobrador vê o indicador das parcelas da carteira dele', async () => {
      expect((await cobr('aba=hoje&limite=100', 'cobrador2')).itens.map((i) => i.indicador)).toEqual(['Outro'])
    })
    it('o indicador não recebe nome de indicador (nem o dele), nem em cobranças nem no cronograma', async () => {
      expect((await cron('?mes=2026-10', 'indicador')).itens.every((i) => i.indicador === null)).toBe(true)
      const c = await cobr('aba=atrasadas&limite=100', 'indicador')
      expect(c.itens.length).toBeGreaterThan(0); expect(c.itens.every((i) => i.indicador === null)).toBe(true)
      expect(JSON.stringify(c)).not.toContain('Roberto')
    })
    it('a busca também acha pelo nome do indicador (e junto com o cliente, em qualquer ordem)', async () => {
      expect((await cron(`?mes=2026-10&busca=roberto`)).itens.map((i) => i.cliente.nome)).toEqual(Array(4).fill('José Conceição'))
      expect((await cron(`?mes=2026-10&busca=outro`)).itens.map((i) => i.cliente.nome)).toEqual(['Bruno Lima'])
      expect((await cron(`?mes=2026-10&busca=${encodeURIComponent('roberto jose')}`)).itens.length).toBe(4)
      expect((await cron(`?mes=2026-10&busca=${encodeURIComponent('bruno roberto')}`)).itens).toEqual([])
      expect((await cobr('aba=hoje&busca=OUTRO&limite=100')).itens.map((i) => i.cliente.nome)).toEqual(['Bruno Lima'])
      expect((await cobr('aba=atrasadas&busca=roberto&limite=100')).itens.map((i) => i.operacaoId)).toEqual([V(), V()])
    })
    it('o indicador não acha pelo nome de indicador (só pelo cliente)', async () => {
      expect((await cobr('aba=atrasadas&busca=roberto&limite=100', 'indicador')).total).toBe(0)
      expect((await cobr('aba=atrasadas&busca=jose&limite=100', 'indicador')).total).toBeGreaterThan(0)
    })
  })

  describe('quem vê o quê', () => {
    it('o admin vê tudo', async () => { expect((await cron('?mes=2026-10')).itens.length).toBe(6) })
    it('o cobrador vê só a carteira dele', async () => {
      expect((await cron('?mes=2026-10', 'cobrador')).itens.every((i) => i.cliente.nome === 'José Conceição')).toBe(true)
      expect((await cron('?mes=2026-10', 'cobrador')).itens.length).toBe(5)
      expect((await cron('?mes=2026-10', 'cobrador2')).itens.map((i) => i.cliente.nome)).toEqual(['Bruno Lima'])
    })
    it('o indicador vê só as operações dele (e só leitura)', async () => {
      const r = await cron('?mes=2026-10', 'indicador')
      expect(chave(r)).toEqual([`V${V()}.2@10-01`, `V${V()}.3@10-10`, `V${V()}.4@10-20`, `V${V()}.5@10-31`])
      expect(JSON.stringify(r)).not.toMatch(/custo|lucro|investido|capital/i)
    })
    it('o vendedor não vê (403) e sem login é 401', async () => {
      expect((await req('/api/cronograma?mes=2026-10', 'vendedor')).statusCode).toBe(403)
      expect((await req('/api/cronograma?mes=2026-10')).statusCode).toBe(401)
    })
  })

  describe('validação', () => {
    it.each(['2026-13', '2026-00', '26-10', 'outubro', '2026-1', '2026-10-01', "2026-10' or 1=1"])('mês inválido (%s) é 400', async (m) => { expect((await req(`/api/cronograma?mes=${encodeURIComponent(m)}`, 'admin')).statusCode).toBe(400) })
    it('tipo inválido e busca longa demais são 400', async () => {
      expect((await req('/api/cronograma?tipo=CARRO', 'admin')).statusCode).toBe(400)
      expect((await req(`/api/cronograma?busca=${'x'.repeat(81)}`, 'admin')).statusCode).toBe(400)
    })
  })

  it('parcela zerada (virou acordo sem nada pago) não aparece; a paga e a em aberto continuam', async () => {
    const e = await emprestimo(id.ana, null, [['2027-06-01', 0], ['2027-06-02', 100], ['2027-06-03', 200]])
    await db!('emprestimo_parcelas').where({ id: e.parcelaIds[0] }).update({ quitada_em: '2027-05-20' })
    await pagar('E', e.parcelaIds[1], id.ana, 100)
    const r = await cron('?mes=2027-06')
    expect(chave(r).filter((c) => c.startsWith(`E${e.id}.`))).toEqual([`E${e.id}.2@06-02`, `E${e.id}.3@06-03`])
  })

  it('passou do limite: devolve até o limite e avisa que cortou', async () => {
    const repo = createRecebimentosRepository(db!)
    const r = await repo.cronograma({ tipo: 'TODOS' }, { de: '2026-10-01', ate: '2026-10-31', limite: 2 })
    expect(r.itens.length).toBe(2); expect(r.cortado).toBe(true)
    expect((await repo.cronograma({ tipo: 'TODOS' }, { de: '2026-10-01', ate: '2026-10-31', limite: 6 })).cortado).toBe(false)
  })
})
