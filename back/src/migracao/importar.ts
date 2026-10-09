import type { Knex } from 'knex'
import { converterCliente, converterIndicador } from './transformar.js'
import type { ClienteNovo, FonteAntiga, IndicadorNovo } from './tipos.js'

export interface Relatorio {
  modo: 'SIMULACAO' | 'APLICADO'
  indicadores: { origem: number; criados: number; jaExistiam: number; semConversao: number }
  clientes: { origem: number; criados: number; jaExistiam: number; conflitos: number; semConversao: number; comIndicador: number }
  /** quantas vezes cada aviso apareceu (o relatório nunca leva nome, CPF, telefone nem e-mail) */
  avisos: Record<string, number>
  /** o que não entrou, só com o id do sistema antigo */
  problemas: { entidade: 'indicador' | 'cliente'; legacyId: number; motivo: string }[]
  /** conferências que passaram antes de gravar (se alguma falhar, nada é gravado) */
  conferencias: string[]
}

class Divergencia extends Error {}

/**
 * Traz indicadores e clientes do sistema antigo. Tudo numa transação: na SIMULAÇÃO ela é desfeita no fim (o relatório é
 * verdadeiro, inclusive para o que o banco recusaria); aplicando, só confirma se as conferências fecharem.
 * Rodar de novo não duplica nem sobrescreve: quem já veio (pelo id antigo) é pulado.
 */
export async function importar(db: Knex, fonte: FonteAntiga, opcoes: { aplicar: boolean }): Promise<Relatorio> {
  const [indicadoresAntigos, clientesAntigos] = await Promise.all([fonte.indicadores(), fonte.clientes()])
  const avisos: Record<string, number> = {}
  const conta = (entidade: string, codigo: string) => { avisos[`${entidade}.${codigo}`] = (avisos[`${entidade}.${codigo}`] ?? 0) + 1 }
  const problemas: Relatorio['problemas'] = []
  const rel: Relatorio = {
    modo: opcoes.aplicar ? 'APLICADO' : 'SIMULACAO',
    indicadores: { origem: indicadoresAntigos.length, criados: 0, jaExistiam: 0, semConversao: 0 },
    clientes: { origem: clientesAntigos.length, criados: 0, jaExistiam: 0, conflitos: 0, semConversao: 0, comIndicador: 0 },
    avisos, problemas, conferencias: [],
  }

  const indicadores: IndicadorNovo[] = []
  for (const a of indicadoresAntigos) {
    const r = converterIndicador(a)
    r.avisos.forEach((c) => conta('indicador', c))
    if (!r.novo) { rel.indicadores.semConversao++; problemas.push({ entidade: 'indicador', legacyId: a.id, motivo: r.erro ?? 'não converteu' }); continue }
    indicadores.push(r.novo)
  }
  const clientes: ClienteNovo[] = []
  for (const a of clientesAntigos) {
    const r = converterCliente(a)
    r.avisos.forEach((c) => conta('cliente', c))
    if (!r.novo) { rel.clientes.semConversao++; problemas.push({ entidade: 'cliente', legacyId: a.id, motivo: r.erro ?? 'não converteu' }); continue }
    clientes.push(r.novo)
  }

  const trx = await db.transaction()
  try {
    // ---------- indicadores ----------
    const idNovoDoIndicador = new Map<number, number>()
    for (const i of indicadores) {
      const ja = await trx('indicadores').where({ legacy_id: i.legacyId }).first<{ id: number } | undefined>('id')
      if (ja) { idNovoDoIndicador.set(i.legacyId, ja.id); rel.indicadores.jaExistiam++; continue }
      const [{ id }] = await trx('indicadores').insert({ nome: i.nome, whatsapp: i.whatsapp, pct: i.pct, pct_manual: i.pctManual, ativo: i.ativo, legacy_id: i.legacyId }).returning('id')
      idNovoDoIndicador.set(i.legacyId, id); rel.indicadores.criados++
    }

    // ---------- clientes ----------
    const cpfsNestaCarga = new Set<string>()
    let esperadosComIndicador = 0
    const criadosNestaCarga: number[] = [] // só estes têm a ligação conferida (os que já existiam podem ter sido editados depois)
    const clientesQueDevemEstar: number[] = [] // os que vieram nesta carga ou já tinham vindo (o conflito fica de fora)
    for (const c of clientes) {
      const ja = await trx('clientes').where({ legacy_id: c.legacyId }).first<{ id: number; indicador_id: number | null } | undefined>('id', 'indicador_id')
      if (ja) {
        rel.clientes.jaExistiam++
        clientesQueDevemEstar.push(c.legacyId)
        continue
      }
      if (c.cpf) {
        const repetidoAqui = cpfsNestaCarga.has(c.cpf)
        const jaNoSistema = await trx('clientes').where({ cpf: c.cpf }).first('id')
        if (repetidoAqui || jaNoSistema) {
          rel.clientes.conflitos++
          problemas.push({ entidade: 'cliente', legacyId: c.legacyId, motivo: repetidoAqui ? 'CPF repetido dentro do sistema antigo' : 'já existe um cliente com este CPF no sistema novo' })
          continue
        }
        cpfsNestaCarga.add(c.cpf)
      }
      let indicadorId: number | null = null
      if (c.indicadorLegacyId !== null) {
        indicadorId = idNovoDoIndicador.get(c.indicadorLegacyId) ?? null
        if (indicadorId === null) conta('cliente', 'indicador_nao_encontrado')
      }
      const quando = c.desde ?? new Date()
      await trx('clientes').insert({
        nome: c.nome, fone: c.fone, cpf: c.cpf, rg: c.rg, endereco: c.endereco, email: c.email, observacoes: c.observacoes,
        origem: null, responsavel_id: null, indicador_id: indicadorId, legacy_id: c.legacyId, created_at: quando, updated_at: quando,
      })
      rel.clientes.criados++
      clientesQueDevemEstar.push(c.legacyId); criadosNestaCarga.push(c.legacyId)
      if (indicadorId !== null) esperadosComIndicador++
    }
    rel.clientes.comIndicador = esperadosComIndicador

    // ---------- conferências (se alguma falhar, nada é gravado) ----------
    const n = async (tabela: string, onde: (q: Knex.QueryBuilder) => Knex.QueryBuilder) => Number(((await onde(trx(tabela)).count('* as n').first()) as { n: string }).n)
    const confere = (ok: boolean, descricao: string) => { if (!ok) throw new Divergencia(`Conferência falhou: ${descricao}`); rel.conferencias.push(`ok: ${descricao}`) }
    // todo indicador e todo cliente que deveria estar, está (o destino pode ter mais: clientes novos do próprio sistema novo)
    const indOk = await n('indicadores', (q) => q.whereIn('legacy_id', indicadores.map((i) => i.legacyId)))
    confere(indOk === indicadores.length, `${indOk} dos ${indicadores.length} indicadores convertidos estão no sistema novo`)
    const cliOk = await n('clientes', (q) => q.whereIn('legacy_id', clientesQueDevemEstar))
    confere(cliOk === clientesQueDevemEstar.length && clientesQueDevemEstar.length + rel.clientes.conflitos + rel.clientes.semConversao === rel.clientes.origem,
      `${cliOk} dos ${rel.clientes.origem} clientes do antigo estão no sistema novo (${rel.clientes.conflitos} em conflito e ${rel.clientes.semConversao} sem conversão ficaram de fora)`)
    const vinc = await n('clientes', (q) => q.whereIn('legacy_id', criadosNestaCarga).whereNotNull('indicador_id'))
    confere(vinc === esperadosComIndicador, `${vinc} dos clientes criados agora ficaram ligados a um indicador, como esperado`)
    const semOrfao = await n('clientes as c', (q) => q.whereIn('c.legacy_id', criadosNestaCarga).whereNotNull('c.indicador_id').whereNotExists(function () { this.select(1).from('indicadores as i').whereRaw('i.id = c.indicador_id') }))
    confere(semOrfao === 0, 'nenhum cliente aponta para indicador que não existe')

    if (opcoes.aplicar) await trx.commit()
    else await trx.rollback()
  } catch (e) {
    await trx.rollback().catch(() => undefined)
    throw e
  }
  return rel
}

/** O relatório em texto, sem nenhum dado pessoal. */
export function formatarRelatorio(r: Relatorio): string {
  const l: string[] = []
  l.push(r.modo === 'SIMULACAO' ? 'SIMULAÇÃO: nada foi gravado.' : 'APLICADO: dados gravados.')
  l.push(`Indicadores: ${r.indicadores.origem} no sistema antigo → ${r.indicadores.criados} criados, ${r.indicadores.jaExistiam} já existiam, ${r.indicadores.semConversao} sem conversão.`)
  l.push(`Clientes: ${r.clientes.origem} no sistema antigo → ${r.clientes.criados} criados, ${r.clientes.jaExistiam} já existiam, ${r.clientes.conflitos} em conflito, ${r.clientes.semConversao} sem conversão. ${r.clientes.comIndicador} dos criados agora ficaram ligados a um indicador.`)
  const chaves = Object.keys(r.avisos).sort()
  if (chaves.length) { l.push('Avisos (quantidade):'); for (const k of chaves) l.push(`  ${k}: ${r.avisos[k]}`) }
  if (r.problemas.length) { l.push('Não entraram (id do sistema antigo):'); for (const p of r.problemas) l.push(`  ${p.entidade} ${p.legacyId}: ${p.motivo}`) }
  l.push('Conferências:'); for (const c of r.conferencias) l.push(`  ${c}`)
  return l.join('\n')
}
