import type { Knex } from 'knex'
import { hojeBR } from '../shared/relogio.js'
import type { EstadoAntigo } from './antigo/tipos.js'
import { transformarOperacao, type EmprestimoNovo } from './antigo/transformar-operacoes.js'

export interface RelatorioOperacoes {
  modo: 'SIMULACAO' | 'APLICADO'
  emprestimos: { origem: number; criados: number; jaExistiam: number; semConversao: number; semCliente: number; semIndicador: number }
  parcelas: number
  recibos: number
  acordos: number
  repasses: { criados: number; jaExistiam: number; semIndicador: number }
  caixa: { criados: number; jaExistiam: number; semIndicador: number }
  totais: { capital: number; recebido: number; repassado: number; transferido: number; aportes: number }
  avisos: Record<string, number>
  problemas: { entidade: string; legacyId: number; motivo: string }[]
  conferencias: string[]
}

class Divergencia extends Error {}
const r2 = (v: number) => Math.round(v * 100) / 100
const soma = (xs: number[]) => r2(xs.reduce((a, b) => a + b, 0))

/**
 * Traz empréstimos, parcelas, recebimentos (um recibo cada), acordos, repasses e caixa do sistema antigo.
 * Os indicadores e clientes já têm de ter vindo (etapa 1): a ligação é pelo id antigo. Tudo numa transação:
 * simulando, ela é desfeita no fim; aplicando, só confirma se TODAS as conferências fecharem. Rodar de novo não duplica.
 */
export async function importarOperacoes(db: Knex, estado: EstadoAntigo, opcoes: { aplicar: boolean; hoje?: string }): Promise<RelatorioOperacoes> {
  const hoje = opcoes.hoje ?? hojeBR()
  const avisos: Record<string, number> = {}
  const conta = (c: string) => { avisos[c] = (avisos[c] ?? 0) + 1 }
  const problemas: RelatorioOperacoes['problemas'] = []
  const rel: RelatorioOperacoes = {
    modo: opcoes.aplicar ? 'APLICADO' : 'SIMULACAO',
    emprestimos: { origem: estado.operacoes.length, criados: 0, jaExistiam: 0, semConversao: 0, semCliente: 0, semIndicador: 0 },
    parcelas: 0, recibos: 0, acordos: 0,
    repasses: { criados: 0, jaExistiam: 0, semIndicador: 0 }, caixa: { criados: 0, jaExistiam: 0, semIndicador: 0 },
    totais: { capital: 0, recebido: 0, repassado: 0, transferido: 0, aportes: 0 }, avisos, problemas, conferencias: [],
  }

  const convertidas: EmprestimoNovo[] = []
  for (const op of estado.operacoes) {
    const r = transformarOperacao(op, estado, hoje)
    r.avisos.forEach(conta)
    if (!r.novo) { rel.emprestimos.semConversao++; problemas.push({ entidade: 'operação', legacyId: op.id, motivo: r.erro ?? 'não converteu' }); continue }
    convertidas.push(r.novo)
  }

  const trx = await db.transaction()
  try {
    const idCliente = new Map<number, number>()
    for (const c of await trx('clientes').whereNotNull('legacy_id').select<{ id: number; legacy_id: number }[]>('id', 'legacy_id')) idCliente.set(c.legacy_id, c.id)
    const idIndicador = new Map<number, number>()
    for (const i of await trx('indicadores').whereNotNull('legacy_id').select<{ id: number; legacy_id: number }[]>('id', 'legacy_id')) idIndicador.set(i.legacy_id, i.id)

    // ---------- empréstimos, parcelas, acordos, recibos ----------
    const entraram: EmprestimoNovo[] = []
    const recibos: { data: string; legacyId: number; criadoEm: string | null; pagamento: EmprestimoNovo['pagamentos'][number]; emprestimoId: number; clienteId: number; parcelaId: Map<number, number> }[] = []
    for (const e of convertidas) {
      const ja = await trx('emprestimos').where({ legacy_id: e.legacyId }).first('id')
      if (ja) { rel.emprestimos.jaExistiam++; continue }
      const clienteId = idCliente.get(e.clienteLegacyId)
      if (clienteId === undefined) { rel.emprestimos.semCliente++; problemas.push({ entidade: 'operação', legacyId: e.legacyId, motivo: 'o cliente ainda não foi importado' }); continue }
      let indicadorId: number | null = null
      if (e.indicadorLegacyId !== null) {
        indicadorId = idIndicador.get(e.indicadorLegacyId) ?? null
        if (indicadorId === null) { rel.emprestimos.semIndicador++; problemas.push({ entidade: 'operação', legacyId: e.legacyId, motivo: 'o indicador ainda não foi importado' }); continue }
      }
      const quando = e.criadoEm ?? `${e.dataEmprestimo}T12:00:00Z`
      const [{ id: emprestimoId }] = await trx('emprestimos').insert({
        cliente_id: clienteId, indicador_id: indicadorId, percentual_indicador: e.pct, data_emprestimo: e.dataEmprestimo, capital: e.capital, modalidade: e.modalidade,
        periodicidade: e.periodicidade, taxa: e.taxa, status: e.status, observacoes: e.observacoes, modo_divisao: e.modoDivisao, legacy_id: e.legacyId, created_at: quando, updated_at: quando,
      }).returning('id')
      rel.emprestimos.criados++; rel.totais.capital = r2(rel.totais.capital + e.capital)

      let acordoId: number | null = null
      if (e.acordo) {
        const a = e.acordo
        const [{ id }] = await trx('acordos').insert({
          emprestimo_id: emprestimoId, data_acordo: a.dataAcordo, saldo_antes: a.saldoAntes, valor_total: a.valorTotal, n_parcelas: a.nParcelas, primeira_parcela: a.primeiraParcela,
          motivo: a.motivo, parcelas_antes: JSON.stringify(a.parcelasAntes), status: 'ATIVO', legacy_id: a.legacyId, created_at: a.dataAcordo, updated_at: a.dataAcordo,
        }).returning('id')
        acordoId = id; rel.acordos++
      }
      const parcelaId = new Map<number, number>()
      for (const p of e.parcelas) {
        const [{ id }] = await trx('emprestimo_parcelas').insert({
          emprestimo_id: emprestimoId, numero: p.numero, vencimento: p.vencimento, vencimento_original: p.vencimentoOriginal, valor: p.valor, desconto: p.desconto, quitada_em: p.quitadaEm,
          acordo_id: p.acordoLegacyId !== null ? acordoId : null, legacy_parcela: p.legacyParcelas.join(','), created_at: quando, updated_at: quando,
        }).returning('id')
        parcelaId.set(p.numero, id); rel.parcelas++
      }
      for (const pg of e.pagamentos) recibos.push({ data: pg.data, legacyId: pg.legacyId, criadoEm: pg.criadoEm, pagamento: pg, emprestimoId, clienteId, parcelaId })
      entraram.push(e)
    }

    // recibos numerados em ordem de data (e depois do id antigo): o número só cresce com o tempo
    recibos.sort((a, b) => a.data.localeCompare(b.data) || a.legacyId - b.legacyId)
    for (const r of recibos) {
      const pg = r.pagamento
      if (await trx('transacoes_recebimento').where({ legacy_id: pg.legacyId }).first('id')) { conta('recibo_ja_existia'); continue }
      let cobrou: number | null = null
      if (pg.cobradoPorIndicadorLegacyId !== null) cobrou = idIndicador.get(pg.cobradoPorIndicadorLegacyId) ?? null
      const quando = r.criadoEm ?? `${r.data}T12:00:00Z`
      const [{ n }] = (await trx.raw("select nextval('recibo_numero_seq') as n")).rows
      const [{ id: transacaoId }] = await trx('transacoes_recebimento').insert({
        numero_recibo: Number(n), cliente_id: r.clienteId, valor_total: pg.valorTotal, forma_pagamento: pg.forma ?? 'PIX', forma_estimada: pg.forma === null, data_recebimento: r.data,
        recebido_por: null, cobrado_por_indicador_id: cobrou, resumo: JSON.stringify(pg.resumo), legacy_id: pg.legacyId, created_at: quando, updated_at: quando,
      }).returning('id')
      for (const it of pg.itens) {
        await trx('recebimentos').insert({ transacao_id: transacaoId, tipo: 'PARCELA', emprestimo_parcela_id: r.parcelaId.get(it.numeroParcela), valor: it.valor, antes: JSON.stringify(it.antes), created_at: quando, updated_at: quando })
      }
      rel.recibos++; rel.totais.recebido = r2(rel.totais.recebido + pg.valorTotal)
    }

    // ---------- repasses ao indicador e caixa ----------
    const nota = 'Importado do sistema antigo (forma de pagamento não registrada).'
    const repasse = async (legacy: string, indicadorLegacy: number, valor: number, data: string, obs: string | null) => {
      if (await trx('repasses_indicador').where({ legacy_id: legacy }).first('id')) { rel.repasses.jaExistiam++; return }
      const ind = idIndicador.get(indicadorLegacy)
      if (ind === undefined) { rel.repasses.semIndicador++; problemas.push({ entidade: 'repasse', legacyId: Number(legacy.split('-')[1]), motivo: 'o indicador ainda não foi importado' }); return }
      await trx('repasses_indicador').insert({ indicador_id: ind, valor, data_repasse: data, forma_pagamento: 'PIX', obs: [obs?.trim(), nota].filter(Boolean).join(' — '), legacy_id: legacy, created_at: `${data}T12:00:00Z`, updated_at: `${data}T12:00:00Z` })
      rel.repasses.criados++; rel.totais.repassado = r2(rel.totais.repassado + valor)
    }
    for (const b of estado.repassesBaixas) await repasse(`baixa-${b.id}`, b.indicadorId, b.valor, b.dataRepasse, b.obs)
    for (const p of estado.repassesPagamentos) await repasse(`pag-${p.id}`, p.indicadorId, p.valor, p.dataPagamento, p.obs)

    const caixa = async (legacy: string, tipo: string, valor: number, data: string, obs: string | null, indicadorLegacy: number | null) => {
      if (await trx('movimentacoes_caixa').where({ legacy_id: legacy }).first('id')) { rel.caixa.jaExistiam++; return }
      let ind: number | null = null
      if (indicadorLegacy !== null) {
        ind = idIndicador.get(indicadorLegacy) ?? null
        if (ind === null) { rel.caixa.semIndicador++; problemas.push({ entidade: 'caixa', legacyId: Number(legacy.split('-')[1]), motivo: 'o indicador ainda não foi importado' }); return }
      }
      await trx('movimentacoes_caixa').insert({ tipo, valor, data, obs: obs?.trim() || null, indicador_id: ind, usuario_id: null, legacy_id: legacy, created_at: `${data}T12:00:00Z`, updated_at: `${data}T12:00:00Z` })
      rel.caixa.criados++
      if (tipo === 'TRANSFERENCIA_INDICADOR') rel.totais.transferido = r2(rel.totais.transferido + valor)
      if (tipo === 'APORTE') rel.totais.aportes = r2(rel.totais.aportes + valor)
    }
    for (const t of estado.transferencias) await caixa(`transf-${t.id}`, 'TRANSFERENCIA_INDICADOR', t.valor, t.dataTransferencia, t.obs, t.indicadorId)
    for (const m of estado.movimentacoesCaixa) await caixa(`cx-${m.id}`, m.tipo, m.valor, m.data, m.obs, null)

    // ---------- conferências (se alguma falhar, nada é gravado) ----------
    const confere = (ok: boolean, descricao: string) => { if (!ok) throw new Divergencia(`Conferência falhou: ${descricao}`); rel.conferencias.push(`ok: ${descricao}`) }
    const legacys = entraram.map((e) => e.legacyId)
    const num = async (sql: string, bind: unknown[] = []) => Number((await trx.raw(sql, bind as never)).rows[0].v)
    const emp = (await trx('emprestimos').whereIn('legacy_id', legacys).count('* as n').first()) as { n: string }
    confere(Number(emp.n) === rel.emprestimos.criados, `${emp.n} empréstimos gravados = ${rel.emprestimos.criados} convertidos`)
    // contra a ORIGEM: tudo o que o sistema antigo recebeu nestas operações tem de estar nos recibos novos
    const nasQueEntraram = new Set(legacys)
    const recebidoNaOrigem = soma(estado.recebimentos.filter((x) => nasQueEntraram.has(x.operacaoId)).map((x) => x.valor))
    confere(recebidoNaOrigem === rel.totais.recebido, `recebido no sistema antigo R$ ${recebidoNaOrigem} = recebido gravado R$ ${rel.totais.recebido}`)
    const recibosNaOrigem = estado.recebimentos.filter((x) => nasQueEntraram.has(x.operacaoId)).length
    confere(recibosNaOrigem === rel.recibos, `${recibosNaOrigem} recebimentos no sistema antigo = ${rel.recibos} recibos gravados`)
    const capitalBanco = await num('select coalesce(sum(capital),0)::float as v from emprestimos where legacy_id = any(?)', [legacys])
    confere(r2(capitalBanco) === rel.totais.capital, `capital no banco R$ ${r2(capitalBanco)} = capital convertido R$ ${rel.totais.capital}`)
    const parcBanco = await num('select count(*)::float as v from emprestimo_parcelas p join emprestimos e on e.id=p.emprestimo_id where e.legacy_id = any(?)', [legacys])
    confere(parcBanco === rel.parcelas, `${parcBanco} parcelas gravadas = ${rel.parcelas} convertidas`)
    const recBanco = await num('select coalesce(sum(r.valor),0)::float as v from recebimentos r join emprestimo_parcelas p on p.id=r.emprestimo_parcela_id join emprestimos e on e.id=p.emprestimo_id where e.legacy_id = any(?)', [legacys])
    confere(r2(recBanco) === rel.totais.recebido, `recebido nas parcelas R$ ${r2(recBanco)} = recebido nos recibos R$ ${rel.totais.recebido}`)
    const trBanco = await num('select coalesce(sum(valor_total),0)::float as v from transacoes_recebimento t where legacy_id = any(?)', [recibos.map((r) => r.pagamento.legacyId)])
    confere(r2(trBanco) === rel.totais.recebido, `soma dos recibos no banco R$ ${r2(trBanco)} = R$ ${rel.totais.recebido}`)
    const estourou = await num('select count(*)::float as v from emprestimo_parcelas p join emprestimos e on e.id=p.emprestimo_id left join (select emprestimo_parcela_id id, sum(valor) pago from recebimentos group by 1) r on r.id=p.id where e.legacy_id = any(?) and coalesce(r.pago,0) > p.valor + 0.009', [legacys])
    confere(estourou === 0, 'nenhuma parcela recebeu mais do que o seu valor')
    const quitadaComSaldo = await num("select count(*)::float as v from emprestimos e where e.legacy_id = any(?) and e.status='QUITADA' and exists (select 1 from emprestimo_parcelas p left join (select emprestimo_parcela_id id, sum(valor) pago from recebimentos group by 1) r on r.id=p.id where p.emprestimo_id=e.id and p.valor - p.desconto - coalesce(r.pago,0) > 0.009)", [legacys])
    confere(quitadaComSaldo === 0, 'nenhum empréstimo quitado tem parcela em aberto')
    const ativaSemSaldo = await num("select count(*)::float as v from emprestimos e where e.legacy_id = any(?) and e.status='ATIVA' and not exists (select 1 from emprestimo_parcelas p left join (select emprestimo_parcela_id id, sum(valor) pago from recebimentos group by 1) r on r.id=p.id where p.emprestimo_id=e.id and p.valor - p.desconto - coalesce(r.pago,0) > 0.009)", [legacys])
    confere(ativaSemSaldo === 0, 'nenhum empréstimo ativo está sem parcela em aberto')
    const semInd = await num('select count(*)::float as v from emprestimos e where e.legacy_id = any(?) and e.indicador_id is null and e.percentual_indicador > 0', [legacys])
    confere(semInd === 0, 'nenhum empréstimo com % de indicador está sem indicador')
    const numeros = await num('select count(distinct numero_recibo)::float as v from transacoes_recebimento where legacy_id = any(?)', [recibos.map((r) => r.pagamento.legacyId)])
    confere(numeros === rel.recibos, `${numeros} números de recibo distintos para ${rel.recibos} recibos`)
    const ordem = await num('select count(*)::float as v from transacoes_recebimento a join transacoes_recebimento b on a.numero_recibo < b.numero_recibo and a.data_recebimento > b.data_recebimento where a.legacy_id is not null and b.legacy_id is not null')
    confere(ordem === 0, 'a numeração dos recibos acompanha a data')

    if (opcoes.aplicar) await trx.commit()
    else await trx.rollback()
  } catch (e) {
    await trx.rollback().catch(() => undefined)
    throw e
  }
  return rel
}

export function formatarRelatorioOperacoes(r: RelatorioOperacoes): string {
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const l: string[] = [r.modo === 'SIMULACAO' ? 'SIMULAÇÃO: nada foi gravado.' : 'APLICADO: dados gravados.']
  const e = r.emprestimos
  l.push(`Empréstimos: ${e.origem} no sistema antigo → ${e.criados} criados, ${e.jaExistiam} já existiam, ${e.semConversao} sem conversão, ${e.semCliente} sem cliente, ${e.semIndicador} sem indicador.`)
  l.push(`Parcelas: ${r.parcelas}. Recibos: ${r.recibos}. Acordos: ${r.acordos}.`)
  l.push(`Repasses: ${r.repasses.criados} criados, ${r.repasses.jaExistiam} já existiam, ${r.repasses.semIndicador} sem indicador. Caixa: ${r.caixa.criados} criados, ${r.caixa.jaExistiam} já existiam, ${r.caixa.semIndicador} sem indicador.`)
  l.push(`Totais: capital ${brl(r.totais.capital)}, recebido ${brl(r.totais.recebido)}, repassado ao indicador ${brl(r.totais.repassado)}, transferido pelo indicador à loja ${brl(r.totais.transferido)}, aportes ${brl(r.totais.aportes)}.`)
  const chaves = Object.keys(r.avisos).sort()
  if (chaves.length) { l.push('Avisos (quantidade de operações/recibos):'); for (const k of chaves) l.push(`  ${k}: ${r.avisos[k]}`) }
  if (r.problemas.length) { l.push('Não entraram (id do sistema antigo):'); for (const p of r.problemas) l.push(`  ${p.entidade} ${p.legacyId}: ${p.motivo}`) }
  l.push('Conferências:'); for (const c of r.conferencias) l.push(`  ${c}`)
  return l.join('\n')
}
