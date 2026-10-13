import type { Knex } from 'knex'
import { filtrarPorTexto } from '../../../shared/busca.js'
import { NOME_EMPRESTIMO_SQL } from '../../../shared/sql.js'
import type { LancamentoManual, Movimento, NovoLancamento, ResumoCaixa, TipoManual } from './types.js'

export interface CaixaRepository {
  resumo(f: { hoje: string; mesIni: string; mesFim: string }): Promise<ResumoCaixa>
  extrato(f: { hoje: string; limite: number; offset: number; busca?: string }): Promise<{ itens: Movimento[]; total: number }>
  buscarManual(id: number): Promise<LancamentoManual | null>
  criarManual(d: NovoLancamento): Promise<LancamentoManual>
  atualizarManual(id: number, d: { tipo: TipoManual; valor: number; data: string; obs: string | null }): Promise<LancamentoManual>
  excluirManual(id: number): Promise<void>
}

const dia = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)
const MANUAIS: TipoManual[] = ['APORTE', 'RETIRADA', 'DESPESA']
const paraManual = (l: { id: number; tipo: TipoManual; valor: string; data: Date | string; obs: string | null }): LancamentoManual => ({ id: l.id, tipo: l.tipo, valor: Number(l.valor), data: dia(l.data), obs: l.obs })

/** A forma de pagamento escrita para o extrato. */
const FORMA_SQL = `case t.forma_pagamento when 'PIX' then 'Pix' when 'DINHEIRO' then 'dinheiro' else 'cartão' end`
const E_ENTRADA_SQL = `exists (select 1 from recebimentos r where r.transacao_id = t.id and r.tipo = 'ENTRADA')`

/**
 * Tudo o que mexe no dinheiro da loja, uma linha por movimento (`entrada` diz se entrou ou saiu), sem corte de data:
 *  entra: recebimento cobrado pela loja (o que o indicador cobrou direto só entra quando ele repassa), repasse do indicador, aporte;
 *  sai: repasse pago ao indicador, retirada, despesa, empréstimo liberado, compra de aparelho.
 * Só conta o que já aconteceu (data até hoje): empréstimo com início marcado para o futuro ainda não tirou dinheiro.
 */
const UNIAO = `
  select 'R' || t.id as chave, t.data_recebimento as data, t.valor_total as valor, true as entrada,
    case when ${E_ENTRADA_SQL} then 'ENTRADA_VENDA' else 'RECEBIMENTO' end as categoria,
    case when ${E_ENTRADA_SQL} then 'Entrada · ' || c.nome else c.nome end as titulo,
    concat_ws(' · ',
      coalesce(
        (select b.modelo from recebimentos r join vendas v on v.id = coalesce(r.venda_id, (select vp.venda_id from venda_parcelas vp where vp.id = r.venda_parcela_id)) join bens b on b.id = v.bem_id where r.transacao_id = t.id limit 1),
        (select ${NOME_EMPRESTIMO_SQL} from recebimentos r join emprestimo_parcelas ep on ep.id = r.emprestimo_parcela_id join emprestimos e on e.id = ep.emprestimo_id where r.transacao_id = t.id limit 1)),
      case when ${E_ENTRADA_SQL} then null else t.resumo->>'referencia' end,
      ${FORMA_SQL}) as sub,
    null::int as manual_id
  from transacoes_recebimento t join clientes c on c.id = t.cliente_id
  where t.desfeita_em is null and t.cobrado_por_indicador_id is null and t.data_recebimento <= :hoje
 union all
  select 'T' || m.id, m.data, m.valor, true, 'TRANSFERENCIA', 'Repasse do indicador · ' || coalesce(i.nome, 'indicador'), 'dinheiro que ele cobrou do cliente', null
  from movimentacoes_caixa m left join indicadores i on i.id = m.indicador_id
  where m.tipo = 'TRANSFERENCIA_INDICADOR' and m.data <= :hoje
 union all
  select 'M' || m.id, m.data, m.valor, m.tipo = 'APORTE', m.tipo, coalesce(nullif(trim(m.obs), ''), case m.tipo when 'APORTE' then 'Aporte' when 'RETIRADA' then 'Retirada' else 'Despesa' end),
    case m.tipo when 'APORTE' then 'Aporte' when 'RETIRADA' then 'Retirada' else 'Despesa' end, m.id
  from movimentacoes_caixa m where m.tipo in ('APORTE', 'RETIRADA', 'DESPESA') and m.data <= :hoje
 union all
  select 'P' || r.id, r.data_repasse, r.valor, false, 'REPASSE', 'Repasse · ' || i.nome, 'parte do lucro', null
  from repasses_indicador r join indicadores i on i.id = r.indicador_id where r.data_repasse <= :hoje
 union all
  select 'E' || e.id, e.data_emprestimo, e.capital, false, 'EMPRESTIMO', 'Empréstimo liberado · ' || c.nome, ${NOME_EMPRESTIMO_SQL}, null
  from emprestimos e join clientes c on c.id = e.cliente_id where e.status <> 'CANCELADA' and e.data_emprestimo <= :hoje
 union all
  select 'B' || b.id, b.data_compra, b.valor_compra + b.custos_extras, false, 'COMPRA', 'Compra · ' || b.modelo || case when b.gb > 0 then ' ' || b.gb || ' GB' else '' end,
    case when b.cor = 'A DEFINIR' then '' else b.cor end, null
  from bens b where b.origem = 'COMPRA' and b.estado <> 'ENCOMENDADO' and b.valor_compra + b.custos_extras > 0 and b.data_compra <= :hoje`

export function createCaixaRepository(db: Knex): CaixaRepository {
  /** O marco zero: antes do primeiro aporte/retirada não existia um saldo rastreado, então nada daquela época conta. */
  const marco = async () => {
    const l = await db('movimentacoes_caixa').whereIn('tipo', ['APORTE', 'RETIRADA']).min({ d: 'data' }).first<{ d: Date | string | null }>()
    return l?.d ? dia(l.d) : null
  }
  /** Os movimentos que contam: até hoje e a partir do marco zero. */
  const contados = (hoje: string, marcoZero: string | null) =>
    db.from(db.raw(`(${UNIAO}) as m`, { hoje })).modify((q) => { if (marcoZero) q.whereRaw('m.data >= ?', [marcoZero]) })

  return {
    async resumo(f) {
      const marcoZero = await marco()
      const [r] = await contados(f.hoje, marcoZero).select<{ saldo: string; entrou: string; saiu: string }[]>(
        db.raw('coalesce(sum(case when m.entrada then m.valor else -m.valor end), 0) as saldo'),
        db.raw('coalesce(sum(m.valor) filter (where m.entrada and m.data between ? and ?), 0) as entrou', [f.mesIni, f.mesFim]),
        db.raw('coalesce(sum(m.valor) filter (where not m.entrada and m.data between ? and ?), 0) as saiu', [f.mesIni, f.mesFim]),
      )
      return { saldo: Number(r.saldo), marcoZero, entrouMes: Number(r.entrou), saiuMes: Number(r.saiu) }
    },

    async extrato(f) {
      const marcoZero = await marco()
      const achados = () => filtrarPorTexto(contados(f.hoje, marcoZero), ['m.titulo', 'm.sub'], f.busca)
      const [{ n }] = await achados().select<{ n: string }[]>(db.raw('count(*) as n'))
      const ls = await achados().select<{ chave: string; data: Date | string; valor: string; entrada: boolean; categoria: Movimento['categoria']; titulo: string; sub: string; manual_id: number | null }[]>('m.*')
        .orderByRaw('m.data desc, m.chave desc').limit(f.limite).offset(f.offset)
      return {
        total: Number(n),
        itens: ls.map((l) => ({ chave: l.chave, data: dia(l.data), valor: Number(l.valor), entrada: l.entrada, categoria: l.categoria, titulo: l.titulo, sub: l.sub, manualId: l.manual_id })),
      }
    },

    async buscarManual(id) {
      const l = await db('movimentacoes_caixa').where({ id }).whereIn('tipo', MANUAIS).first()
      return l ? paraManual(l) : null
    },
    async criarManual(d) {
      const [l] = await db('movimentacoes_caixa').insert({ tipo: d.tipo, valor: d.valor, data: d.data, obs: d.obs, usuario_id: d.usuarioId }).returning('*')
      return paraManual(l)
    },
    async atualizarManual(id, d) {
      const [l] = await db('movimentacoes_caixa').where({ id }).whereIn('tipo', MANUAIS).update({ tipo: d.tipo, valor: d.valor, data: d.data, obs: d.obs, updated_at: db.fn.now() }).returning('*')
      return paraManual(l)
    },
    async excluirManual(id) { await db('movimentacoes_caixa').where({ id }).whereIn('tipo', MANUAIS).del() },
  }
}
