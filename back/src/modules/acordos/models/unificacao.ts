import type { Knex } from 'knex'
import { HttpError, naoEncontrado, requisicaoInvalida } from '../../../shared/errors.js'
import { PAGO_PARCELA_EMPRESTIMO_SQL } from '../../../shared/sql.js'
import { arred2 } from '../../vendas/services/calculo.js'
import { distribuir, vencimentoDoAcordo, type PeriodicidadeAcordo } from './acordo.js'

export const UNIFICAR_MIN = 2
export const UNIFICAR_MAX = 10

export type PedidoUnificacao = {
  usuarioId: number; emprestimoIds: number[]; valorTotal: number; n: number; primeira: string; periodicidade: PeriodicidadeAcordo
  capitalAdicional: number; motivo: string | null; dia: string
  /** só quando os empréstimos têm indicadores (ou %) diferentes: quem fica com o novo (null = sem indicador) */
  indicadorId?: number | null
}
export type OrigemUnificada = { emprestimoId: number; saldo: number; capitalCedido: number; parcelasEncerradas: number; acordoId: number }
export type ResultadoUnificacao = {
  emprestimoId: number; acordoId: number; origens: OrigemUnificada[]; saldoAntes: number; valorTotal: number; nParcelas: number; primeiraParcela: string
  periodicidade: PeriodicidadeAcordo; capitalAdicional: number; capitalHerdado: number; capital: number
}

/** O pedido não diz quem é o indicador do novo, e os empréstimos de origem não concordam. */
const indicadorNecessario = () => new HttpError(400, 'Os empréstimos têm indicadores (ou percentuais) diferentes: escolha quem fica com o novo, ou nenhum.', 'INDICADOR_NECESSARIO')
const dia = (x: Date | string | null) => (x === null ? null : (typeof x === 'string' ? x : x.toISOString()).slice(0, 10))

/**
 * Junta o que vários empréstimos do mesmo cliente ainda têm em aberto num empréstimo NOVO, com um acordo só, tudo na mesma transação
 * (as linhas de origem são travadas aqui, em ordem de id).
 *  - o aberto de cada origem fica "encerrado por acordo"; o que já foi pago continua nela;
 *  - o capital que ainda estava na rua em cada origem (capital − o que já voltou) passa para o novo; a origem fica com o capital que voltou,
 *    então o lucro dela é o que já ganhou e o do novo é só o que vem daqui para a frente. A soma do lucro de todos não muda;
 *  - o dinheiro novo soma no capital do novo e sai do Caixa hoje.
 */
export async function unificarEmprestimos(trx: Knex.Transaction, d: PedidoUnificacao): Promise<ResultadoUnificacao> {
  const ids = [...new Set(d.emprestimoIds)].sort((a, b) => a - b)
  if (ids.length !== d.emprestimoIds.length) throw requisicaoInvalida('Há empréstimo repetido na seleção')
  if (ids.length < UNIFICAR_MIN || ids.length > UNIFICAR_MAX) throw requisicaoInvalida(`Escolha de ${UNIFICAR_MIN} a ${UNIFICAR_MAX} empréstimos para unificar`)

  const linhas = await trx('emprestimos').whereIn('id', ids).orderBy('id').forUpdate()
    .select<{ id: number; cliente_id: number; indicador_id: number | null; percentual_indicador: string; status: string; capital: string }[]>('id', 'cliente_id', 'indicador_id', 'percentual_indicador', 'status', 'capital')
  if (linhas.length !== ids.length) throw naoEncontrado('Empréstimo não encontrado')
  if (new Set(linhas.map((l) => l.cliente_id)).size !== 1) throw new HttpError(400, 'Só dá para unificar empréstimos do mesmo cliente', 'CLIENTES_DIFERENTES')
  const bloqueado = linhas.find((l) => l.status === 'CANCELADA')
  if (bloqueado) throw new HttpError(409, `O empréstimo #${bloqueado.id} foi cancelado`, 'VENDA_ENCERRADA')

  const ps = await trx('emprestimo_parcelas as p').whereIn('p.emprestimo_id', ids).orderBy(['p.emprestimo_id', 'p.numero'])
    .select<{ id: number; emprestimo_id: number; numero: number; valor: string; desconto: string; vencimento: Date | string; vencimento_original: Date | string | null; pago: string }[]>(
      'p.id', 'p.emprestimo_id', 'p.numero', 'p.valor', 'p.desconto', 'p.vencimento', 'p.vencimento_original', trx.raw(`${PAGO_PARCELA_EMPRESTIMO_SQL} as pago`))
  // capital que já voltou por amortização adiantada (só juros): conta como dinheiro recebido, como em toda a ficha
  const am = await trx('transacoes_recebimento as t').whereNull('t.desfeita_em').whereNotNull('t.ajustes')
    .join(trx('recebimentos as r').join('emprestimo_parcelas as p', 'p.id', 'r.emprestimo_parcela_id').whereIn('p.emprestimo_id', ids).distinct('r.transacao_id', 'p.emprestimo_id').as('x'), 'x.transacao_id', 't.id')
    .groupBy('x.emprestimo_id').select<{ emprestimo_id: number; soma: string | null }[]>('x.emprestimo_id', trx.raw("sum((t.ajustes->>'amortizacao')::numeric) as soma"))
  const amortizado = new Map(am.map((a) => [a.emprestimo_id, Number(a.soma ?? 0)]))

  const origens = linhas.map((l) => {
    const todas = ps.filter((p) => p.emprestimo_id === l.id)
    const abertas = todas.map((p) => ({ ...p, falta: arred2(Number(p.valor) - Number(p.pago) - Number(p.desconto)) })).filter((p) => p.falta > 0.009)
    const recebido = arred2((amortizado.get(l.id) ?? 0) + todas.reduce((x, p) => x + Number(p.pago), 0))
    const capital = Number(l.capital)
    return { l, abertas, saldo: arred2(abertas.reduce((x, p) => x + p.falta, 0)), capital, capitalCedido: arred2(capital - Math.min(capital, recebido)) }
  })
  const semSaldo = origens.find((o) => !o.abertas.length)
  if (semSaldo) throw new HttpError(409, `O empréstimo #${semSaldo.l.id} não tem nada em aberto para unificar`, 'SEM_SALDO')

  // indicador do novo: herda quando todos concordam; senão o administrador escolhe
  const chaves = origens.map((o) => `${o.l.indicador_id ?? 'x'}|${Number(o.l.percentual_indicador)}`)
  let indicadorId: number | null; let pct: number
  if (new Set(chaves).size === 1) { indicadorId = origens[0].l.indicador_id; pct = Number(origens[0].l.percentual_indicador) }
  else if (d.indicadorId === undefined) throw indicadorNecessario()
  else if (d.indicadorId === null) { indicadorId = null; pct = 0 }
  else {
    const ind = await trx('indicadores').where({ id: d.indicadorId, ativo: true }).first<{ id: number; pct: string } | undefined>('id', 'pct')
    if (!ind) throw requisicaoInvalida('Indicador não encontrado ou desativado')
    indicadorId = ind.id; pct = Number(ind.pct) // o % fica congelado neste empréstimo, como em todo empréstimo novo
  }

  const saldoAntes = arred2(origens.reduce((x, o) => x + o.saldo, 0))
  const capitalHerdado = arred2(origens.reduce((x, o) => x + o.capitalCedido, 0))
  const capital = arred2(capitalHerdado + d.capitalAdicional)
  // juro "no total" do novo, só para a ficha: quanto o total passa do capital (a conta de lucro não depende dele)
  const taxa = capital > 0 ? Math.min(999.9999, Math.max(0, Math.round(((d.valorTotal / capital) - 1) * 1e6) / 1e4)) : 0
  const diaria = d.periodicidade === 'DIARIA'

  const [{ id: novoId }] = await trx('emprestimos').insert({
    cliente_id: origens[0].l.cliente_id, indicador_id: indicadorId, percentual_indicador: pct, data_emprestimo: d.dia, capital, modalidade: diaria ? 'DIARIA' : 'PARCELADO', taxa,
    periodicidade: d.periodicidade, pula_domingo: true, modo_divisao: 'CAPITAL_PRIMEIRO',
    observacoes: `Unificação dos empréstimos ${ids.map((i) => '#' + i).join(', ')}`,
  }).returning('id')

  const [{ id: acordoNovoId }] = await trx('acordos').insert({
    emprestimo_id: novoId, criado_por: d.usuarioId, data_acordo: d.dia, saldo_antes: saldoAntes, valor_total: d.valorTotal, capital_adicional: d.capitalAdicional, capital_herdado: capitalHerdado,
    periodicidade: d.periodicidade, n_parcelas: d.n, primeira_parcela: d.primeira, motivo: d.motivo, parcelas_antes: JSON.stringify([]),
  }).returning('id')
  const valores = distribuir(d.valorTotal, d.n)
  await trx('emprestimo_parcelas').insert(valores.map((valor, i) => ({ emprestimo_id: novoId, numero: i + 1, vencimento: vencimentoDoAcordo(d.primeira, i, d.periodicidade), valor, acordo_id: acordoNovoId })))

  const saida: OrigemUnificada[] = []
  for (const o of origens) {
    const anterior = await trx('acordos').where({ emprestimo_id: o.l.id, status: 'ATIVO' }).first<{ id: number } | undefined>('id')
    if (anterior) await trx('acordos').where({ id: anterior.id }).update({ status: 'SUBSTITUIDO', updated_at: trx.fn.now() })
    const [{ id: acordoId }] = await trx('acordos').insert({
      emprestimo_id: o.l.id, criado_por: d.usuarioId, data_acordo: d.dia, saldo_antes: o.saldo, valor_total: o.saldo, n_parcelas: d.n, primeira_parcela: d.primeira, periodicidade: d.periodicidade,
      motivo: d.motivo, unificado_em_id: novoId, capital_cedido: o.capitalCedido,
      parcelas_antes: JSON.stringify(o.abertas.map((p) => ({ numero: p.numero, valor: Number(p.valor), desconto: Number(p.desconto), pago: Number(p.pago), falta: p.falta, vencimento: dia(p.vencimento), vencimentoOriginal: dia(p.vencimento_original) }))),
    }).returning('id')
    for (const p of o.abertas) await trx('emprestimo_parcelas').where({ id: p.id }).update({ valor: arred2(Number(p.pago) + Number(p.desconto)), quitada_em: d.dia, encerrada_acordo_id: acordoId, updated_at: trx.fn.now() })
    // a origem fica com o capital que já voltou (o resto foi para o novo) e sai das em andamento
    await trx('emprestimos').where({ id: o.l.id }).update({ capital: arred2(o.capital - o.capitalCedido), status: 'QUITADA', updated_at: trx.fn.now() })
    await trx('aprovacoes').where({ emprestimo_id: o.l.id, status: 'PENDENTE' }).whereIn('tipo', ['DESCONTO', 'ACORDO'])
      .update({ status: 'RECUSADO', respondido_por: d.usuarioId, respondido_em: trx.fn.now(), resposta: 'Empréstimo unificado', updated_at: trx.fn.now() })
    saida.push({ emprestimoId: o.l.id, saldo: o.saldo, capitalCedido: o.capitalCedido, parcelasEncerradas: o.abertas.length, acordoId })
  }
  return { emprestimoId: novoId, acordoId: acordoNovoId, origens: saida, saldoAntes, valorTotal: d.valorTotal, nParcelas: d.n, primeiraParcela: d.primeira, periodicidade: d.periodicidade, capitalAdicional: d.capitalAdicional, capitalHerdado, capital }
}
