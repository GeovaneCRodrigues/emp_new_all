import type { Knex } from 'knex'
import { HttpError, naoEncontrado } from '../../../shared/errors.js'
import { PAGO_PARCELA_SQL } from '../../../shared/sql.js'
import { arred2 } from '../services/calculo.js'

export type ResultadoRetomada = { vendaId: number; bemId: number; modelo: string; emAberto: number; atrasadas: number; parcelasAbertas: number }

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/**
 * Retoma o aparelho de uma venda, DENTRO de uma transação em que a linha da venda já está travada (FOR UPDATE).
 * É a mesma regra quando o administrador retoma direto e quando ele aprova o pedido do cobrador:
 *  - só vale para venda em andamento que tenha parcela atrasada;
 *  - a venda vira RETOMADA (o dinheiro já recebido continua no histórico) e sai das cobranças e do "a receber";
 *  - o aparelho volta ao estoque como disponível (sem encomenda), com a data de hoje;
 *  - pedidos de aprovação que ainda esperavam sobre essa venda são recusados ("Venda retomada").
 */
export async function retomarVenda(trx: Knex.Transaction, d: { vendaId: number; usuarioId: number; motivo: string | null; dia: string; excetoPedidoId?: number }): Promise<ResultadoRetomada> {
  const v = await trx('vendas as v').join('bens as b', 'b.id', 'v.bem_id').where('v.id', d.vendaId)
    .first<{ id: number; status: string; bem_id: number; modelo: string; observacoes: string | null } | undefined>('v.id', 'v.status', 'v.bem_id', 'b.modelo', 'b.observacoes')
  if (!v) throw naoEncontrado('Venda não encontrada')
  if (v.status !== 'ATIVA') throw new HttpError(409, 'Só dá para retomar o aparelho de uma venda em andamento', 'VENDA_NAO_RETOMAVEL')

  const ps = await trx('venda_parcelas as p').where('p.venda_id', d.vendaId)
    .select<{ valor: string; desconto: string; vencimento: Date | string; pago: string }[]>('p.valor', 'p.desconto', 'p.vencimento', trx.raw(`${PAGO_PARCELA_SQL} as pago`))
  const abertas = ps.map((p) => ({ falta: arred2(Number(p.valor) - Number(p.pago) - Number(p.desconto)), venc: (typeof p.vencimento === 'string' ? p.vencimento : p.vencimento.toISOString()).slice(0, 10) })).filter((p) => p.falta > 0.009)
  const atrasadas = abertas.filter((p) => p.venc < d.dia)
  if (!atrasadas.length) throw new HttpError(409, 'Só dá para retomar quando o cliente tem parcela atrasada', 'SEM_ATRASO')

  await trx('vendas').where({ id: d.vendaId }).update({ status: 'RETOMADA', retomada_em: trx.fn.now(), retomada_por: d.usuarioId, retomada_motivo: d.motivo, updated_at: trx.fn.now() })
  const nota = `Retomado da venda #${d.vendaId} em ${dmy(d.dia)}.`
  await trx('bens').where({ id: v.bem_id }).update({
    estado: 'DISPONIVEL', cliente_encomenda_id: null, data_compra: d.dia, observacoes: v.observacoes ? `${v.observacoes}\n${nota}` : nota, updated_at: trx.fn.now(),
  })
  await trx('aprovacoes').where({ venda_id: d.vendaId, status: 'PENDENTE' }).whereNot('id', d.excetoPedidoId ?? -1)
    .update({ status: 'RECUSADO', respondido_por: d.usuarioId, respondido_em: trx.fn.now(), resposta: 'Venda retomada', updated_at: trx.fn.now() })
  return { vendaId: d.vendaId, bemId: v.bem_id, modelo: v.modelo, emAberto: arred2(abertas.reduce((s, p) => s + p.falta, 0)), atrasadas: atrasadas.length, parcelasAbertas: abertas.length }
}
