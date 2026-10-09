/** Quanto já entrou numa parcela de venda (`p`): recebimentos de transações que não foram desfeitas. */
export const PAGO_PARCELA_SQL = `coalesce((select sum(r.valor) from recebimentos r join transacoes_recebimento t on t.id = r.transacao_id where r.venda_parcela_id = p.id and t.desfeita_em is null), 0)`
