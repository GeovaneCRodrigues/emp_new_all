import type { Knex } from 'knex'
import { addDia, somaMes } from '../../../shared/datas.js'
import { HttpError, naoEncontrado, requisicaoInvalida } from '../../../shared/errors.js'
import { PAGO_PARCELA_EMPRESTIMO_SQL, PAGO_PARCELA_SQL } from '../../../shared/sql.js'
import { arred2 } from '../../vendas/services/calculo.js'

export type AlvoAcordo = 'VENDA' | 'EMPRESTIMO'
export type ResultadoAcordo = { acordoId: number; alvo: AlvoAcordo; operacaoId: number; saldoAntes: number; valorTotal: number; nParcelas: number; primeiraParcela: string; parcelasEncerradas: number; substituiuAcordoId: number | null }

const T = {
  VENDA: { op: 'vendas', parcela: 'venda_parcelas', opFk: 'venda_id', pago: PAGO_PARCELA_SQL },
  EMPRESTIMO: { op: 'emprestimos', parcela: 'emprestimo_parcelas', opFk: 'emprestimo_id', pago: PAGO_PARCELA_EMPRESTIMO_SQL },
} as const

export const ACORDO_MAX_PARCELAS = 120
const DINHEIRO_MAX = 100_000_000

/** Divide o total em n parcelas: as primeiras com o valor arredondado para baixo e a última com o resto, para a soma fechar no centavo. */
export function distribuir(total: number, n: number): number[] {
  const base = Math.floor((total / n) * 100) / 100
  const valores = Array.from({ length: n - 1 }, () => base)
  valores.push(arred2(total - base * (n - 1)))
  return valores
}

/** Valida a proposta (a mesma para o administrador direto e para o pedido do cobrador). */
export function validarProposta(e: { valorTotal: unknown; parcelas: unknown; primeiraParcela: unknown }, hoje: string): { valorTotal: number; n: number; primeira: string } {
  if (typeof e.valorTotal !== 'number' || !Number.isFinite(e.valorTotal) || e.valorTotal <= 0 || e.valorTotal > DINHEIRO_MAX) throw requisicaoInvalida('Informe o valor do acordo (maior que zero)')
  if (typeof e.parcelas !== 'number' || !Number.isInteger(e.parcelas) || e.parcelas < 1 || e.parcelas > ACORDO_MAX_PARCELAS) throw requisicaoInvalida(`Informe entre 1 e ${ACORDO_MAX_PARCELAS} parcelas`)
  const p = e.primeiraParcela
  if (typeof p !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p) || new Date(p + 'T12:00:00Z').toISOString().slice(0, 10) !== p) throw requisicaoInvalida('A data da 1ª parcela precisa ser uma data válida (AAAA-MM-DD)')
  if (p < hoje) throw requisicaoInvalida('A 1ª parcela não pode ser numa data que já passou')
  if (p > addDia(hoje, 366)) throw requisicaoInvalida('A 1ª parcela não pode passar de um ano')
  if (arred2(e.valorTotal) / e.parcelas < 0.01) throw requisicaoInvalida('O valor do acordo é pequeno demais para essa quantidade de parcelas')
  return { valorTotal: arred2(e.valorTotal), n: e.parcelas, primeira: p }
}

/**
 * Faz o acordo DENTRO de uma transação em que a linha da venda/empréstimo já está travada (FOR UPDATE). É a mesma regra
 * quando o administrador faz direto e quando aprova o pedido do cobrador.
 *  - só em operação em andamento com saldo; `saldoEsperado` (pedido do cobrador) tem de bater, senão o pedido ficou velho;
 *  - as parcelas abertas viram "encerradas por acordo": ficam só com o que já foi pago (e o desconto) e saem das cobranças;
 *  - as parcelas novas continuam a numeração, mês a mês no dia da 1ª; a soma é exatamente o valor do acordo;
 *  - o acordo anterior que ainda estava de pé é marcado como substituído;
 *  - pedidos de desconto e de acordo que esperavam sobre a operação são recusados ("Acordo feito").
 */
export async function fazerAcordo(trx: Knex.Transaction, d: {
  alvo: AlvoAcordo; operacaoId: number; usuarioId: number; valorTotal: number; n: number; primeira: string; motivo: string | null; dia: string; aprovacaoId?: number; saldoEsperado?: number
}): Promise<ResultadoAcordo> {
  const t = T[d.alvo]
  const op = await trx(t.op).where({ id: d.operacaoId }).first<{ id: number; status: string } | undefined>('id', 'status')
  if (!op) throw naoEncontrado(d.alvo === 'VENDA' ? 'Venda não encontrada' : 'Empréstimo não encontrado')
  if (op.status === 'RETOMADA' || op.status === 'CANCELADA') throw new HttpError(409, d.alvo === 'VENDA' ? 'Esta venda foi retomada ou cancelada' : 'Este empréstimo foi cancelado', 'VENDA_ENCERRADA')

  const ps = await trx(`${t.parcela} as p`).where(`p.${t.opFk}`, d.operacaoId).orderBy('p.numero')
    .select<{ id: number; numero: number; valor: string; desconto: string; vencimento: Date | string; vencimento_original: Date | string | null; quitada_em: Date | string | null; pago: string }[]>('p.id', 'p.numero', 'p.valor', 'p.desconto', 'p.vencimento', 'p.vencimento_original', 'p.quitada_em', trx.raw(`${t.pago} as pago`))
  const dia = (x: Date | string | null) => (x === null ? null : (typeof x === 'string' ? x : x.toISOString()).slice(0, 10))
  const abertas = ps.map((p) => ({ ...p, falta: arred2(Number(p.valor) - Number(p.pago) - Number(p.desconto)) })).filter((p) => p.falta > 0.009)
  if (op.status !== 'ATIVA' || !abertas.length) throw new HttpError(409, 'Não há nada em aberto para renegociar', 'SEM_SALDO')
  const saldo = arred2(abertas.reduce((s, p) => s + p.falta, 0))
  if (d.saldoEsperado !== undefined && Math.abs(saldo - d.saldoEsperado) > 0.009) {
    throw new HttpError(409, `O que falta mudou desde o pedido (era ${d.saldoEsperado.toFixed(2).replace('.', ',')}, agora ${saldo.toFixed(2).replace('.', ',')}). Recuse o pedido e peça de novo.`, 'PEDIDO_DESATUALIZADO')
  }

  // o acordo que estava de pé sai de cena (as parcelas abertas dele são justamente as que estamos encerrando)
  const anterior = await trx('acordos').where({ [t.opFk]: d.operacaoId, status: 'ATIVO' }).first<{ id: number } | undefined>('id')
  if (anterior) await trx('acordos').where({ id: anterior.id }).update({ status: 'SUBSTITUIDO', updated_at: trx.fn.now() })

  const [{ id: acordoId }] = await trx('acordos').insert({
    [t.opFk]: d.operacaoId, criado_por: d.usuarioId, aprovacao_id: d.aprovacaoId ?? null, data_acordo: d.dia, saldo_antes: saldo, valor_total: d.valorTotal, n_parcelas: d.n,
    primeira_parcela: d.primeira, motivo: d.motivo,
    parcelas_antes: JSON.stringify(abertas.map((p) => ({ numero: p.numero, valor: Number(p.valor), desconto: Number(p.desconto), pago: Number(p.pago), falta: p.falta, vencimento: dia(p.vencimento), vencimentoOriginal: dia(p.vencimento_original) }))),
  }).returning('id')

  // encerra as abertas: ficam só com o que já foi pago e o desconto concedido
  for (const p of abertas) {
    await trx(t.parcela).where({ id: p.id }).update({ valor: arred2(Number(p.pago) + Number(p.desconto)), quitada_em: d.dia, encerrada_acordo_id: acordoId, updated_at: trx.fn.now() })
  }
  // as novas, na sequência da numeração
  const proximo = Math.max(...ps.map((p) => p.numero)) + 1
  const valores = distribuir(d.valorTotal, d.n)
  const diaMes = Number(d.primeira.slice(8, 10))
  await trx(t.parcela).insert(valores.map((valor, i) => ({ [t.opFk]: d.operacaoId, numero: proximo + i, vencimento: somaMes(d.primeira, i, diaMes), valor, acordo_id: acordoId })))

  await trx('aprovacoes').where({ [t.opFk]: d.operacaoId, status: 'PENDENTE' }).whereIn('tipo', ['DESCONTO', 'ACORDO']).whereNot('id', d.aprovacaoId ?? -1)
    .update({ status: 'RECUSADO', respondido_por: d.usuarioId, respondido_em: trx.fn.now(), resposta: 'Acordo feito', updated_at: trx.fn.now() })
  return { acordoId, alvo: d.alvo, operacaoId: d.operacaoId, saldoAntes: saldo, valorTotal: d.valorTotal, nParcelas: d.n, primeiraParcela: d.primeira, parcelasEncerradas: abertas.length, substituiuAcordoId: anterior?.id ?? null }
}
