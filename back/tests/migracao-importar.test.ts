import type { Knex } from 'knex'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { formatarRelatorio, importar } from '../src/migracao/importar.js'
import type { ClienteAntigo, FonteAntiga, IndicadorAntigo } from '../src/migracao/tipos.js'
import { bancoDeTeste, limparBanco } from './helpers/db.js'

const db: Knex | null = await bancoDeTeste()

const cli = (id: number, o: Partial<ClienteAntigo> = {}): ClienteAntigo => ({
  id, nome: `Cliente Fictício ${id}`, cpf_cnpj: null, rg: null, telefone1: null, telefone2: null, email: null, endereco: null, numero: null, complemento: null, bairro: null,
  cidade: null, uf: 'SP', cep: null, indicador_id: null, status: 'ATIVO', obs: null, created_at: '2026-05-05T10:00:00Z', ...o,
})
const ind = (id: number, o: Partial<IndicadorAntigo> = {}): IndicadorAntigo => ({ id, nome: `Indicador Fictício ${id}`, telefone: '11988120000', email: `i${id}@x.com`, status: 'ATIVO', percentuais: [{ pct: 0.5, qtd: 5 }], ...o })
const fonte = (indicadores: IndicadorAntigo[], clientes: ClienteAntigo[]): FonteAntiga => ({ indicadores: async () => indicadores, clientes: async () => clientes })

// CPFs válidos
const CPF = ['52998224725', '11144477735', '39053344705', '16899535009']

describe.skipIf(!db)('importar indicadores e clientes do sistema antigo (Postgres de verdade)', () => {
  const conta = async (t: string) => Number(((await db!(t).count('* as n').first()) as { n: string }).n)
  beforeEach(async () => { await limparBanco(db!) })
  afterAll(async () => { await db?.destroy() })

  const cenario = () => fonte(
    [ind(1, { telefone: '(11) 98812-4410' }), ind(2, { status: 'INATIVO', percentuais: [{ pct: 0.3, qtd: 1 }] }), ind(3, { percentuais: [] })],
    [
      cli(10, { cpf_cnpj: '529.982.247-25', telefone1: '(11) 98812-4410', email: 'Ana@Exemplo.com', obs: 'paga sempre no dia 10', indicador_id: 1, endereco: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Campinas', uf: 'SP', cep: '13000000', created_at: '2026-05-05T10:00:00Z' }),
      cli(11, { cpf_cnpj: '111.444.777-35', indicador_id: 2 }), // sem telefone
      cli(12, { cpf_cnpj: '11.222.333/0001-81', telefone1: '1133334444', indicador_id: 1 }), // CNPJ
      cli(13, { indicador_id: null }), // sem CPF, sem telefone, sem indicador
      cli(14, { cpf_cnpj: '390.533.447-05', indicador_id: 99 }), // indicador que não veio
    ],
  )

  it('SIMULAÇÃO: o relatório é completo mas NADA é gravado', async () => {
    const r = await importar(db!, cenario(), { aplicar: false })
    expect(r.modo).toBe('SIMULACAO')
    expect(r.indicadores).toMatchObject({ origem: 3, criados: 3, jaExistiam: 0 })
    expect(r.clientes).toMatchObject({ origem: 5, criados: 5, conflitos: 0 })
    expect(await conta('indicadores')).toBe(0); expect(await conta('clientes')).toBe(0)
  })

  it('APLICAR: grava tudo com os campos certos, o id antigo, a data original e as ligações', async () => {
    const r = await importar(db!, cenario(), { aplicar: true })
    expect(r.modo).toBe('APLICADO')
    expect(await conta('indicadores')).toBe(3); expect(await conta('clientes')).toBe(5)
    const i1 = await db!('indicadores').where({ legacy_id: 1 }).first()
    expect(i1).toMatchObject({ nome: 'INDICADOR FICTÍCIO 1', whatsapp: '11988124410', pct_manual: true, ativo: true, legacy_id: 1 })
    expect(Number(i1.pct)).toBe(0.5)
    const i2 = await db!('indicadores').where({ legacy_id: 2 }).first()
    expect(i2.ativo).toBe(false); expect(Number(i2.pct)).toBe(0.3)
    expect(Number((await db!('indicadores').where({ legacy_id: 3 }).first()).pct)).toBe(0.5) // sem % → padrão

    const c10 = await db!('clientes').where({ legacy_id: 10 }).first()
    expect(c10).toMatchObject({ nome: 'CLIENTE FICTÍCIO 10', cpf: '52998224725', fone: '11988124410', email: 'ana@exemplo.com', observacoes: 'paga sempre no dia 10', endereco: 'RUA A, 10, CENTRO, CAMPINAS/SP, CEP 13000-000', origem: null, responsavel_id: null })
    expect(c10.indicador_id).toBe(i1.id)
    expect(new Date(c10.created_at).toISOString()).toBe('2026-05-05T10:00:00.000Z')
    expect((await db!('clientes').where({ legacy_id: 11 }).first()).fone).toBe('') // sem telefone
    expect((await db!('clientes').where({ legacy_id: 11 }).first()).indicador_id).toBe(i2.id)
    expect((await db!('clientes').where({ legacy_id: 12 }).first()).cpf).toBe('11222333000181') // CNPJ
    const c13 = await db!('clientes').where({ legacy_id: 13 }).first()
    expect(c13.cpf).toBeNull(); expect(c13.indicador_id).toBeNull()
    expect((await db!('clientes').where({ legacy_id: 14 }).first()).indicador_id).toBeNull() // o indicador 99 não veio
    expect(r.avisos['cliente.indicador_nao_encontrado']).toBe(1)
    expect(r.clientes.comIndicador).toBe(3)
    expect(r.conferencias.length).toBe(4)
  })

  it('o indicador vinculado enxerga o cliente (a ligação que importa para o portal)', async () => {
    await importar(db!, cenario(), { aplicar: true })
    const i1 = await db!('indicadores').where({ legacy_id: 1 }).first()
    const doIndicador = await db!('clientes').where({ indicador_id: i1.id }).orderBy('legacy_id')
    expect(doIndicador.map((c: { legacy_id: number }) => c.legacy_id)).toEqual([10, 12])
  })

  it('rodar de novo não duplica nem mexe no que já veio (nem no que foi editado depois)', async () => {
    await importar(db!, cenario(), { aplicar: true })
    await db!('clientes').where({ legacy_id: 10 }).update({ nome: 'Nome Editado No Sistema Novo', fone: '11977776666' })
    const r = await importar(db!, cenario(), { aplicar: true })
    expect(r.indicadores).toMatchObject({ criados: 0, jaExistiam: 3 })
    expect(r.clientes).toMatchObject({ criados: 0, jaExistiam: 5, conflitos: 0 })
    expect(await conta('indicadores')).toBe(3); expect(await conta('clientes')).toBe(5)
    expect(await db!('clientes').where({ legacy_id: 10 }).first()).toMatchObject({ nome: 'Nome Editado No Sistema Novo', fone: '11977776666' })
  })

  it('só traz o que falta quando o sistema antigo ganhou clientes novos', async () => {
    await importar(db!, cenario(), { aplicar: true })
    const mais = fonte([ind(1), ind(2), ind(3)], [cli(10), cli(15, { cpf_cnpj: CPF[3], indicador_id: 3 })])
    const r = await importar(db!, mais, { aplicar: true })
    expect(r.clientes).toMatchObject({ origem: 2, criados: 1, jaExistiam: 1 })
    expect(await conta('clientes')).toBe(6)
  })

  it('CPF que já existe no sistema novo: conflito (não duplica nem sobrescreve), o resto entra', async () => {
    await db!('clientes').insert({ nome: 'Já Cadastrada', fone: '11988120001', cpf: '52998224725' })
    const r = await importar(db!, cenario(), { aplicar: true })
    expect(r.clientes).toMatchObject({ criados: 4, conflitos: 1 })
    expect(r.problemas).toEqual([{ entidade: 'cliente', legacyId: 10, motivo: expect.stringContaining('já existe') }])
    expect(await db!('clientes').where({ cpf: '52998224725' }).count('* as n').first().then((l) => Number((l as { n: string }).n))).toBe(1)
    expect(await db!('clientes').where({ legacy_id: 10 }).first()).toBeUndefined()
    expect(r.conferencias.every((c) => c.startsWith('ok'))).toBe(true)
  })

  it('CPF repetido dentro do próprio sistema antigo: o 2º é conflito', async () => {
    const r = await importar(db!, fonte([], [cli(1, { cpf_cnpj: CPF[0] }), cli(2, { cpf_cnpj: '529.982.247-25' })]), { aplicar: true })
    expect(r.clientes).toMatchObject({ criados: 1, conflitos: 1 })
    expect(r.problemas[0]).toMatchObject({ legacyId: 2, motivo: expect.stringContaining('repetido') })
  })

  it('quem não converte (sem nome) fica de fora, é listado só por id, e o resto entra', async () => {
    const r = await importar(db!, fonte([ind(1, { nome: '' })], [cli(1, { nome: '  ' }), cli(2)]), { aplicar: true })
    expect(r.indicadores).toMatchObject({ criados: 0, semConversao: 1 })
    expect(r.clientes).toMatchObject({ criados: 1, semConversao: 1 })
    expect(r.problemas.map((p) => `${p.entidade}:${p.legacyId}`).sort()).toEqual(['cliente:1', 'indicador:1'])
  })

  it('se uma conferência não fecha, NADA é gravado (tudo desfeito)', async () => {
    const duplicado = fonte([ind(1)], [cli(7), cli(7)]) // o mesmo id antigo duas vezes: a conta não fecha
    await expect(importar(db!, duplicado, { aplicar: true })).rejects.toThrow(/Conferência falhou/)
    expect(await conta('indicadores')).toBe(0); expect(await conta('clientes')).toBe(0)
  })

  it('o relatório é só números e ids: sem nome, CPF, telefone nem e-mail', async () => {
    const r = await importar(db!, cenario(), { aplicar: false })
    const texto = (formatarRelatorio(r) + JSON.stringify(r)).toLowerCase()
    for (const dado of ['Fictício', '52998224725', '529.982.247-25', '988124410', 'ana@exemplo.com', 'Rua A', 'paga sempre']) expect(texto, dado).not.toContain(dado.toLowerCase())
    expect(texto).toContain('simulação')
  })

  it('bases vazias: não faz nada e não quebra', async () => {
    const r = await importar(db!, fonte([], []), { aplicar: true })
    expect(r.indicadores.origem + r.clientes.origem).toBe(0)
    expect(r.conferencias.length).toBe(4)
  })

  it('o cliente importado funciona no sistema: telefone vazio e CNPJ não quebram a lista nem a busca', async () => {
    await importar(db!, cenario(), { aplicar: true })
    const todos = await db!('clientes').select('nome', 'fone', 'cpf').orderBy('legacy_id')
    expect(todos).toHaveLength(5)
    expect(todos.filter((c: { fone: string }) => c.fone === '')).toHaveLength(3) // 11, 13 e 14 não têm telefone
  })
})
