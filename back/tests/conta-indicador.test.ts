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
    it('empréstimo guarda de onde saiu o dinheiro; o check recusa valor maior que o capital ou sem indicador', async () => {
      const [e] = await db!('emprestimos').insert({ cliente_id: m.id.ana, data_emprestimo: '2026-10-01', capital: 1000, modalidade: 'PARCELADO', taxa: 10, periodicidade: 'MENSAL', saiu_da_conta_indicador_id: m.id.roberto, saiu_da_conta_valor: 600 }).returning('id')
      expect(Number((await db!('emprestimos').where({ id: e.id }).first()).saiu_da_conta_valor)).toBe(600)
      const base = { cliente_id: m.id.ana, data_emprestimo: '2026-10-01', capital: 1000, modalidade: 'PARCELADO', taxa: 10, periodicidade: 'MENSAL' }
      await expect(db!('emprestimos').insert({ ...base, saiu_da_conta_indicador_id: m.id.roberto, saiu_da_conta_valor: 1000.01 })).rejects.toThrow()
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
})
