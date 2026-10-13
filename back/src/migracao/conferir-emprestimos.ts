import 'dotenv/config'
import { parseEnv } from '../config/env.js'
import { createDb } from '../db/connection.js'
import { abrirFonteMysql } from './fonte-mysql.js'
import { gerarCronogramaAntigo } from './antigo/cronograma.js'

/**
 * Conferência SÓ LEITURA, empréstimo a empréstimo: o que o sistema antigo mostra × o que está no sistema novo.
 *   OLD_MYSQL_URL=... npx tsx src/migracao/conferir-emprestimos.ts [AAAA-MM-DD]
 * Não grava em nenhum dos dois bancos.
 */
const dia = (d: unknown) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10))
const r2 = (v: number) => Math.round(v * 100) / 100
const hoje = process.argv[2] ?? new Date().toISOString().slice(0, 10)
const urlAntigo = process.env.OLD_MYSQL_URL
if (!urlAntigo) { console.error('Informe OLD_MYSQL_URL'); process.exit(1) }

const db = createDb(parseEnv())
const fonte = await abrirFonteMysql(urlAntigo)
try {
  const est = await fonte.estadoOperacoes()
  const antigas = gerarCronogramaAntigo({ operacoes: est.operacoes, recebimentos: est.recebimentos, parcelasExtras: est.parcelasExtras, parcelaAjustes: est.parcelaAjustes, quitacoes: est.quitacoes, parcelaVencimentos: est.parcelaVencimentos, acordos: est.acordos, hoje })
  const emp = await db.knex('emprestimos').whereNotNull('legacy_id').select('id', 'legacy_id', 'status', 'capital', 'modalidade', 'percentual_indicador', 'indicador_id')
  const parc = await db.knex('emprestimo_parcelas as p').join('emprestimos as e', 'e.id', 'p.emprestimo_id').whereNotNull('e.legacy_id')
    .leftJoin(db.knex('recebimentos').select('emprestimo_parcela_id').sum({ pago: 'valor' }).groupBy('emprestimo_parcela_id').as('r'), 'r.emprestimo_parcela_id', 'p.id')
    .select('e.legacy_id as op', 'p.numero', 'p.vencimento', 'p.valor', 'p.desconto', 'p.quitada_em', db.knex.raw('coalesce(r.pago,0) as pago'))

  const linhas: { op: number; mod: string; stAnt: string; stNovo: string; recAnt: number; recNovo: number; vencAnt: number; vencNovo: number; abertoAnt: number; abertoNovo: number; nAnt: number; nNovo: number; motivos: string[] }[] = []
  const naoMigradas: string[] = []
  for (const op of est.operacoes) {
    const e = emp.find((x) => Number(x.legacy_id) === op.id)
    if (!e) { naoMigradas.push(`#${op.id} (${op.modalidade}, ${op.status})`); continue }
    const pa = antigas.filter((p) => p.operacaoId === op.id)
    const pn = parc.filter((p) => Number(p.op) === op.id)
    const recAnt = r2(est.recebimentos.filter((r) => r.operacaoId === op.id).reduce((s, r) => s + r.valor, 0))
    const recNovo = r2(pn.reduce((s, p) => s + Number(p.pago), 0))
    const faltaN = (p: typeof pn[number]) => r2(Number(p.valor) - Number(p.desconto) - Number(p.pago))
    const abertoAnt = r2(pa.reduce((s, p) => s + p.valorFalta, 0))
    const abertoNovo = r2(pn.reduce((s, p) => s + Math.max(0, faltaN(p)), 0))
    const vencAnt = r2(pa.filter((p) => p.vencimentoIso <= hoje).reduce((s, p) => s + p.valorFalta, 0))
    const vencNovo = r2(pn.filter((p) => dia(p.vencimento) <= hoje).reduce((s, p) => s + Math.max(0, faltaN(p)), 0))
    const stAntivo = pa.some((p) => p.valorFalta > 0.009) ? 'ATIVA' : 'QUITADA'
    const m: string[] = []
    if (Math.abs(recAnt - recNovo) > 0.009) m.push(`recebido ${recAnt}≠${recNovo}`)
    if (Math.abs(vencAnt - vencNovo) > 0.009) m.push(`vencido ${vencAnt}≠${vencNovo}`)
    if (op.modalidade !== 'JUROS' && Math.abs(abertoAnt - abertoNovo) > 0.009) m.push(`em aberto ${abertoAnt}≠${abertoNovo}`)
    if (stAntivo !== e.status) m.push(`status ${stAntivo}(cronograma antigo)≠${e.status}`)
    const adicional = r2(est.acordos.filter((a) => a.operacaoId === op.id).reduce((s, a) => s + a.capitalAdicional, 0))
    if (Math.abs(Number(e.capital) - op.valorOriginal - adicional) > 0.009) m.push(`capital ${op.valorOriginal}+acordo ${adicional}≠${e.capital}`)
    const pctNovo = Number(e.percentual_indicador)
    if (Math.abs(pctNovo - op.percentualParceiro * (op.indicadorId ? 1 : 0)) > 0.0001 && op.indicadorId) m.push(`% indicador ${op.percentualParceiro}≠${pctNovo}`)
    linhas.push({ op: op.id, mod: op.modalidade, stAnt: stAntivo, stNovo: e.status, recAnt, recNovo, vencAnt, vencNovo, abertoAnt, abertoNovo, nAnt: pa.length, nNovo: pn.length, motivos: m })
  }
  const orfas = emp.filter((e) => !est.operacoes.some((o) => o.id === Number(e.legacy_id)))
  console.log(`Hoje=${hoje}. Antigas: ${est.operacoes.length}. Migradas: ${linhas.length}. Não migradas: ${naoMigradas.length}${naoMigradas.length ? ' → ' + naoMigradas.join('; ') : ''}. No novo sem origem: ${orfas.length}.`)
  const div = linhas.filter((l) => l.motivos.length)
  console.log(`Divergentes: ${div.length} de ${linhas.length}\n`)
  for (const l of div) console.log(`#${l.op} ${l.mod} [${l.stAnt}→${l.stNovo}] parcelas ${l.nAnt}→${l.nNovo}: ${l.motivos.join(' | ')}`)
  const soma = (f: (l: typeof linhas[number]) => number) => r2(linhas.reduce((s, l) => s + f(l), 0))
  console.log(`\nTotais — recebido antigo ${soma((l) => l.recAnt)} × novo ${soma((l) => l.recNovo)}; vencido antigo ${soma((l) => l.vencAnt)} × novo ${soma((l) => l.vencNovo)}`)
  console.log(`Em aberto (sem só juros): antigo ${soma((l) => (l.mod === 'JUROS' ? 0 : l.abertoAnt))} × novo ${soma((l) => (l.mod === 'JUROS' ? 0 : l.abertoNovo))}`)
} finally {
  await fonte.fechar()
  await db.close()
}
