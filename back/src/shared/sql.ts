/** Quanto já entrou numa parcela de venda (`p`): recebimentos de transações que não foram desfeitas. */
export const PAGO_PARCELA_SQL = `coalesce((select sum(r.valor) from recebimentos r join transacoes_recebimento t on t.id = r.transacao_id where r.venda_parcela_id = p.id and t.desfeita_em is null), 0)`

/** O que já entrou numa parcela de empréstimo `p` (recebimentos de transações não desfeitas). */
export const PAGO_PARCELA_EMPRESTIMO_SQL = `coalesce((select sum(r.valor) from recebimentos r join transacoes_recebimento t on t.id = r.transacao_id
  where r.emprestimo_parcela_id = p.id and t.desfeita_em is null), 0)`

/** "Empréstimo parcelado", "Empréstimo só juros semanal", "Empréstimo diária" (a frequência só aparece quando não é mensal). */
const NOME_MOD: Record<string, string> = { PARCELADO: 'parcelado', JUROS: 'só juros', DIARIA: 'diária' }
const NOME_FREQ: Record<string, string> = { MENSAL: 'mensal', QUINZENAL: 'quinzenal', SEMANAL: 'semanal', DIARIA: 'diária' }
export const nomeEmprestimo = (modalidade: string, periodicidade: string) => `Empréstimo ${NOME_MOD[modalidade] ?? modalidade.toLowerCase()}${modalidade !== 'DIARIA' && periodicidade !== 'MENSAL' ? ` ${NOME_FREQ[periodicidade] ?? periodicidade.toLowerCase()}` : ''}`

/** O mesmo nome, montado no SQL (alias `e` = tabela emprestimos). */
export const NOME_EMPRESTIMO_SQL = `('Empréstimo ' || case e.modalidade when 'PARCELADO' then 'parcelado' when 'JUROS' then 'só juros' else 'diária' end
  || case when e.modalidade <> 'DIARIA' and e.periodicidade <> 'MENSAL' then ' ' || case e.periodicidade when 'QUINZENAL' then 'quinzenal' when 'SEMANAL' then 'semanal' else lower(e.periodicidade) end else '' end)`
