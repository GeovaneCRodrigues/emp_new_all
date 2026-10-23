import type { Knex } from 'knex'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { bancoDeTeste } from './helpers/db.js'
import { montarMundo, type Mundo } from './helpers/conta-mundo.js'

const db: Knex | null = await bancoDeTeste()

describe.skipIf(!db)('conta corrente do indicador (Postgres de verdade)', () => {
  let m: Mundo
  beforeAll(async () => { m = await montarMundo(db!) })
  beforeEach(async () => { await m.limpar() })
  afterAll(async () => { await m?.app.close(); await db?.destroy() })

  describe('o banco', () => {
    it('empréstimo guarda de onde saiu o dinheiro; o check recusa valor negativo ou sem indicador (o limite do capital é do serviço)', async () => {
      const [e] = await db!('emprestimos').insert({ cliente_id: m.id.ana, data_emprestimo: '2026-10-01', capital: 1000, modalidade: 'PARCELADO', taxa: 10, periodicidade: 'MENSAL', saiu_da_conta_indicador_id: m.id.roberto, saiu_da_conta_valor: 600 }).returning('id')
      expect(Number((await db!('emprestimos').where({ id: e.id }).first()).saiu_da_conta_valor)).toBe(600)
      const base = { cliente_id: m.id.ana, data_emprestimo: '2026-10-01', capital: 1000, modalidade: 'PARCELADO', taxa: 10, periodicidade: 'MENSAL' }
      await expect(db!('emprestimos').insert({ ...base, saiu_da_conta_indicador_id: m.id.roberto, saiu_da_conta_valor: -1 })).rejects.toThrow()
      await expect(db!('emprestimos').insert({ ...base, saiu_da_conta_indicador_id: null, saiu_da_conta_valor: 10 })).rejects.toThrow()
      await expect(db!('emprestimos').insert({ ...base, saiu_da_conta_valor: 0 })).resolves.toBeDefined()
    })
  })

  describe('o Caixa', () => {
    const caixa = async () => (await m.req('GET', '/api/caixa', 'admin')).json() as { saldo: number; itens: { chave: string; valor: number; entrada: boolean; categoria: string; sub: string }[] }
    const saidaDoEmprestimo = async (e: number) => (await caixa()).itens.find((i) => i.chave === `E${e}`)

    it('empréstimo pago só pelo Caixa: sai o capital todo (como sempre)', async () => {
      const e = await m.emprestimo()
      expect(await saidaDoEmprestimo(e)).toMatchObject({ valor: 1000, entrada: false, categoria: 'EMPRESTIMO' })
    })
    it('empréstimo pago em parte pela conta do indicador: o Caixa só perde o resto, e o extrato diz de quem foi o dinheiro', async () => {
      const e = await m.emprestimo()
      await db!('emprestimos').where({ id: e }).update({ saiu_da_conta_indicador_id: m.id.roberto, saiu_da_conta_valor: 600 })
      const linha = await saidaDoEmprestimo(e)
      expect(linha).toMatchObject({ valor: 400, entrada: false })
      expect(linha!.sub).toContain('R$ 600,00 da conta do indicador')
    })
    it('empréstimo pago todo pela conta do indicador: não aparece no Caixa', async () => {
      const e = await m.emprestimo()
      await db!('emprestimos').where({ id: e }).update({ saiu_da_conta_indicador_id: m.id.roberto, saiu_da_conta_valor: 1000 })
      expect(await saidaDoEmprestimo(e)).toBeUndefined()
      expect((await caixa()).saldo).toBe(0)
    })
  })

  describe('empréstimo novo "saiu da conta do indicador"', () => {
    const criar = (extra: object) => m.req('POST', '/api/emprestimos', 'admin', { clienteId: m.id.ana, modalidade: 'PARCELADO', capital: 1000, taxa: 30, parcelas: 2, ...extra })

    it('grava de onde saiu o dinheiro (de qualquer indicador, não só o do empréstimo) e audita', async () => {
      const r = await criar({ indicadorId: m.id.roberto, saiuDaConta: { indicadorId: m.id.carla, valor: 600 } })
      expect(r.statusCode, r.body).toBe(201)
      const l = await db!('emprestimos').where({ id: r.json().id }).first()
      expect(l.saiu_da_conta_indicador_id).toBe(m.id.carla)
      expect(Number(l.saiu_da_conta_valor)).toBe(600)
      const a = await db!('auditoria').where({ acao: 'EMPRESTIMO_CRIADO', entidade_id: r.json().id }).first()
      expect(a.depois.saiuDaConta).toEqual({ indicadorId: m.id.carla, valor: 600 })
    })
    it('sem saiuDaConta, tudo como antes (zero, sem indicador)', async () => {
      const r = await criar({})
      const l = await db!('emprestimos').where({ id: r.json().id }).first()
      expect(l.saiu_da_conta_indicador_id).toBeNull(); expect(Number(l.saiu_da_conta_valor)).toBe(0)
    })
    it('o valor pode ser o capital todo', async () => {
      expect((await criar({ saiuDaConta: { indicadorId: m.id.roberto, valor: 1000 } })).statusCode).toBe(201)
    })
    it.each([
      ['valor maior que o capital', { indicadorId: 1, valor: 1000.01 }], ['valor zero', { indicadorId: 1, valor: 0 }], ['valor negativo', { indicadorId: 1, valor: -5 }],
      ['valor como texto', { indicadorId: 1, valor: '300' }], ['sem valor', { indicadorId: 1 }], ['sem indicador', { valor: 300 }], ['indicador quebrado', { indicadorId: 1.5, valor: 300 }],
      ['indicador inexistente', { indicadorId: 999999, valor: 300 }], ['não é objeto', 'sim'],
    ])('recusa %s (400) e não grava nada', async (_nome, saiuDaConta) => {
      const corpo = typeof saiuDaConta === 'object' && saiuDaConta && 'indicadorId' in saiuDaConta && saiuDaConta.indicadorId === 1 ? { ...saiuDaConta, indicadorId: m.id.roberto } : saiuDaConta
      const r = await criar({ saiuDaConta: corpo })
      expect(r.statusCode, r.body).toBe(400)
      expect(Number((await db!('emprestimos').count('* as n').first() as { n: string }).n)).toBe(0)
    })
    it('indicador desativado não serve', async () => {
      await db!('indicadores').where({ id: m.id.carla }).update({ ativo: false })
      try { expect((await criar({ saiuDaConta: { indicadorId: m.id.carla, valor: 100 } })).statusCode).toBe(400) }
      finally { await db!('indicadores').where({ id: m.id.carla }).update({ ativo: true }) }
    })
  })

  describe('confirmar a baixa "na conta do indicador"', () => {
    const avisar = (corpo: object = {}, papel = 'indicador', op?: number) => m.req('POST', '/api/aprovacoes', papel, { tipo: 'BAIXA', alvo: 'EMPRESTIMO', operacaoId: op, parcela: 1, valor: 650, forma: 'PIX', ...corpo })
    const confirmar = (pid: number, corpo: object = {}) => m.req('POST', `/api/aprovacoes/${pid}/aprovar`, 'admin', corpo)
    const ultimaTransacao = async () => db!('transacoes_recebimento').orderBy('id', 'desc').first()
    const caixa = async () => (await m.req('GET', '/api/caixa', 'admin')).json() as { itens: { chave: string }[] }

    it('o aviso guarda a marca; a loja confirma sem mexer e a transação fica no nome do indicador, FORA do Caixa', async () => {
      const e = await m.emprestimo()
      const a = await avisar({ naContaDoIndicador: true }, 'indicador', e)
      expect(a.statusCode, a.body).toBe(201)
      expect(a.json().baixa.naContaDoIndicador).toBe(true)
      expect((await confirmar(a.json().id)).statusCode).toBe(200)
      const t = await ultimaTransacao()
      expect(t.cobrado_por_indicador_id).toBe(m.id.roberto)
      expect((await caixa()).itens.some((i) => i.chave === `R${t.id}`)).toBe(false)
    })
    it('a loja pode DESMARCAR na confirmação (o dinheiro foi para a loja): entra no Caixa como sempre', async () => {
      const e = await m.emprestimo()
      const a = await avisar({ naContaDoIndicador: true }, 'indicador', e)
      expect((await confirmar(a.json().id, { naContaDoIndicador: false })).statusCode).toBe(200)
      const t = await ultimaTransacao()
      expect(t.cobrado_por_indicador_id).toBeNull()
      expect((await caixa()).itens.some((i) => i.chave === `R${t.id}`)).toBe(true)
    })
    it('a loja pode MARCAR na confirmação mesmo que o indicador não tenha marcado', async () => {
      const e = await m.emprestimo()
      const a = await avisar({}, 'indicador', e)
      expect((await confirmar(a.json().id, { naContaDoIndicador: true })).statusCode).toBe(200)
      expect((await ultimaTransacao()).cobrado_por_indicador_id).toBe(m.id.roberto)
    })
    it('sem marcar nada, continua igual a hoje: entra no Caixa, sem indicador na transação', async () => {
      const e = await m.emprestimo()
      const a = await avisar({}, 'indicador', e)
      expect((await confirmar(a.json().id)).statusCode).toBe(200)
      const t = await ultimaTransacao()
      expect(t.cobrado_por_indicador_id).toBeNull()
      expect((await caixa()).itens.some((i) => i.chave === `R${t.id}`)).toBe(true)
    })
    it('quitação vinda do aviso "quitou" + na conta do indicador: a transação da quitação também fica fora do Caixa', async () => {
      const e = await m.emprestimo()
      const total = (await db!('emprestimo_parcelas').where({ emprestimo_id: e })).reduce((s: number, p: { valor: string }) => s + Number(p.valor), 0)
      const a = await avisar({ quitou: true, valor: total, naContaDoIndicador: true }, 'indicador', e)
      expect(a.statusCode, a.body).toBe(201)
      const r = await confirmar(a.json().id, { quitar: true, valor: total })
      expect(r.statusCode, r.body).toBe(200)
      expect((await ultimaTransacao()).cobrado_por_indicador_id).toBe(m.id.roberto)
    })
    it('naContaDoIndicador precisa ser verdadeiro/falso (400) no aviso e na confirmação', async () => {
      const e = await m.emprestimo()
      expect((await avisar({ naContaDoIndicador: 'sim' }, 'indicador', e)).statusCode).toBe(400)
      const a = await avisar({}, 'indicador', e)
      expect((await confirmar(a.json().id, { naContaDoIndicador: 'sim' })).statusCode).toBe(400)
      expect((await db!('aprovacoes').where({ id: a.json().id }).first()).status).toBe('PENDENTE')
    })
  })

  describe('a conta corrente', () => {
    const conta = async (ind: number, papel = 'admin') => m.req('GET', `/api/indicadores/${ind}/conta`, papel)
    const envio = (ind: number, corpo: object, papel = 'admin') => m.req('POST', `/api/indicadores/${ind}/conta/envios`, papel, corpo)
    /** uma transação (e o recebimento) cobrada pelo indicador, para o saldo contar */
    async function cobrouDoCliente(ind: number, valor: number, data = '2026-10-05', desfeita = false) {
      const e = await m.emprestimo()
      const [p] = await db!('emprestimo_parcelas').where({ emprestimo_id: e }).orderBy('numero').limit(1)
      const [t] = await db!('transacoes_recebimento').insert({
        numero_recibo: Math.floor(Math.random() * 1e9), cliente_id: m.id.ana, valor_total: valor, forma_pagamento: 'PIX', data_recebimento: data,
        cobrado_por_indicador_id: ind, desfeita_em: desfeita ? new Date() : null, resumo: JSON.stringify({ referencia: 'parcela 1/2' }),
      }).returning('id')
      await db!('recebimentos').insert({ transacao_id: t.id, tipo: 'PARCELA', emprestimo_parcela_id: p.id, valor })
      return { empId: e, transacaoId: t.id as number }
    }

    it('conta vazia: saldo zero', async () => {
      const r = await conta(m.id.roberto)
      expect(r.statusCode).toBe(200)
      expect(r.json()).toMatchObject({ indicador: { id: m.id.roberto, nome: 'Roberto' }, saldo: 0, cobrou: 0, enviou: 0, emprestou: 0, itens: [], total: 0 })
    })
    it('saldo = cobrou − enviou − emprestou, e o extrato traz cada lançamento com seu tipo', async () => {
      await cobrouDoCliente(m.id.roberto, 1500)
      expect((await envio(m.id.roberto, { valor: 400, data: '2026-10-07', comprovante: 'E2E1' })).statusCode).toBe(201)
      await m.emprestimo({ saiuDaConta: { indicadorId: m.id.roberto, valor: 300 } })
      const r = (await conta(m.id.roberto)).json()
      expect(r).toMatchObject({ saldo: 800, cobrou: 1500, enviou: 400, emprestou: 300, total: 3 })
      expect(r.itens.map((i: { tipo: string }) => i.tipo).sort()).toEqual(['COBROU', 'EMPRESTIMO', 'ENVIOU'])
      expect(r.itens.find((i: { tipo: string }) => i.tipo === 'ENVIOU')).toMatchObject({ valor: 400, data: '2026-10-07', sub: 'E2E1' })
      expect(r.itens.find((i: { tipo: string }) => i.tipo === 'COBROU')).toMatchObject({ valor: 1500, titulo: 'Ana Souza', sub: 'parcela 1/2' })
    })
    it('o envio entra no Caixa na data (já contava como "Repasse do indicador") e o que o indicador cobrou não', async () => {
      await cobrouDoCliente(m.id.roberto, 1500)
      await envio(m.id.roberto, { valor: 400, data: '2026-10-07' })
      const cx = (await m.req('GET', '/api/caixa', 'admin')).json() as { saldo: number; itens: { categoria: string; valor: number }[] }
      expect(cx.itens.filter((i) => i.categoria === 'TRANSFERENCIA')).toHaveLength(1)
      expect(cx.itens.find((i) => i.categoria === 'TRANSFERENCIA')!.valor).toBe(400)
      expect(cx.itens.some((i) => i.categoria === 'RECEBIMENTO')).toBe(false)
    })
    it('um indicador não mexe na conta do outro', async () => {
      await cobrouDoCliente(m.id.roberto, 1500)
      expect((await conta(m.id.carla)).json().saldo).toBe(0)
    })
    it('DESFAZER o recebimento tira do saldo sozinho', async () => {
      await cobrouDoCliente(m.id.roberto, 1500)
      const { transacaoId } = await cobrouDoCliente(m.id.roberto, 200)
      expect((await conta(m.id.roberto)).json().saldo).toBe(1700)
      await db!('transacoes_recebimento').where({ id: transacaoId }).update({ desfeita_em: new Date() })
      expect((await conta(m.id.roberto)).json().saldo).toBe(1500)
    })
    it('empréstimo CANCELADO devolve o valor ao saldo', async () => {
      await cobrouDoCliente(m.id.roberto, 1000)
      const e = await m.emprestimo({ saiuDaConta: { indicadorId: m.id.roberto, valor: 600 } })
      expect((await conta(m.id.roberto)).json().saldo).toBe(400)
      await db!('emprestimos').where({ id: e }).update({ status: 'CANCELADA' })
      expect((await conta(m.id.roberto)).json().saldo).toBe(1000)
    })
    it('envio acima do saldo é aceito (vira crédito do indicador: saldo negativo)', async () => {
      expect((await envio(m.id.roberto, { valor: 250 })).statusCode).toBe(201)
      expect((await conta(m.id.roberto)).json().saldo).toBe(-250)
    })
    it('paginação do extrato (limite e página)', async () => {
      for (let i = 0; i < 3; i++) await envio(m.id.roberto, { valor: 10 + i, data: `2026-10-0${i + 1}` })
      const r = (await m.req('GET', `/api/indicadores/${m.id.roberto}/conta?pagina=2&limite=2`, 'admin')).json()
      expect(r).toMatchObject({ total: 3, pagina: 2, limite: 2 })
      expect(r.itens).toHaveLength(1)
    })
    it.each([
      ['valor zero', { valor: 0 }], ['valor negativo', { valor: -1 }], ['valor como texto', { valor: '100' }], ['sem valor', {}], ['valor gigante', { valor: 1e9 }],
      ['data no futuro', { valor: 10, data: '2026-10-09' }], ['data inválida', { valor: 10, data: '2026-02-31' }], ['comprovante enorme', { valor: 10, comprovante: 'x'.repeat(121) }],
      ['lado inventado', { valor: 10, lado: 'CARRO' }],
    ])('envio com %s é recusado (400) e não grava', async (_n, corpo) => {
      expect((await envio(m.id.roberto, corpo)).statusCode).toBe(400)
      expect(await db!('movimentacoes_caixa').count('* as n').first().then((l) => Number((l as { n: string }).n))).toBe(0)
    })
    it('indicador inexistente: 404', async () => {
      expect((await conta(999999)).statusCode).toBe(404)
      expect((await envio(999999, { valor: 10 })).statusCode).toBe(404)
    })
    it('permissões: lançar envio só o administrador; o indicador vê só a própria conta (a do outro é 404); cobrador 403; sem login 401', async () => {
      for (const papel of ['indicador', 'indicador2', 'cobrador']) expect((await envio(m.id.roberto, { valor: 10 }, papel)).statusCode).toBe(403)
      expect((await m.req('POST', `/api/indicadores/${m.id.roberto}/conta/envios`, undefined, { valor: 10 })).statusCode).toBe(401)
      expect((await conta(m.id.roberto, 'indicador')).statusCode).toBe(200)
      expect((await conta(m.id.roberto, 'indicador2')).statusCode).toBe(404)
      expect((await conta(m.id.roberto, 'cobrador')).statusCode).toBe(403)
      expect((await m.req('GET', `/api/indicadores/${m.id.roberto}/conta`)).statusCode).toBe(401)
    })
    it('a lista de saldos é só do administrador e traz todos os indicadores', async () => {
      await cobrouDoCliente(m.id.roberto, 900)
      const r = await m.req('GET', '/api/contas-indicadores', 'admin')
      expect(r.statusCode).toBe(200)
      expect(r.json().itens.find((i: { indicador: { id: number } }) => i.indicador.id === m.id.roberto).saldo).toBe(900)
      expect(r.json().itens.find((i: { indicador: { id: number } }) => i.indicador.id === m.id.carla).saldo).toBe(0)
      expect((await m.req('GET', '/api/contas-indicadores', 'indicador')).statusCode).toBe(403)
    })
    it('lançar envio audita', async () => {
      await envio(m.id.roberto, { valor: 77 })
      const a = await db!('auditoria').where({ acao: 'ENVIO_INDICADOR_LANCADO' }).first()
      expect(a.depois).toMatchObject({ indicadorId: m.id.roberto, valor: 77 })
    })
  })

  describe('unificar empréstimo que usou a conta do indicador', () => {
    it('a unificação passa (o capital da origem vai a zero) e o Caixa continua certo: a origem tira só o resto, o novo não tira nada', async () => {
      const a = await m.emprestimo({ saiuDaConta: { indicadorId: m.id.roberto, valor: 600 } })
      const b = await m.emprestimo()
      const caixa = async () => (await m.req('GET', '/api/caixa', 'admin')).json() as { itens: { chave: string; valor: number }[] }
      const r = await m.req('POST', '/api/emprestimos/unificar', 'admin', { emprestimoIds: [a, b], valorTotal: 2600, parcelas: 2, primeiraParcela: '2026-12-01' })
      expect(r.statusCode, r.body).toBe(201)
      const novo = r.json().emprestimoId as number
      const itens = (await caixa()).itens
      expect(itens.find((i) => i.chave === `E${a}`)!.valor).toBe(400)
      expect(itens.find((i) => i.chave === `E${b}`)!.valor).toBe(1000)
      expect(itens.some((i) => i.chave === `E${novo}`)).toBe(false)
      expect(Number((await db!('emprestimos').where({ id: a }).first()).saiu_da_conta_valor)).toBe(600) // a origem mantém de onde saiu
    })
  })
})
