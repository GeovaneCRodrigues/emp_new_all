import type { Knex } from 'knex'
import { filtrarPorTexto } from '../../../shared/busca.js'
import { NOME_EMPRESTIMO_SQL } from '../../../shared/sql.js'
import { FILTROS_LADO, type FiltroLado, type Lado, type LancamentoManual, type Movimento, type NovoLancamento, type ResumoCaixa, type SaldoLado, type TipoManual } from './types.js'

export interface CaixaRepository {
  resumo(f: { hoje: string; mesIni: string; mesFim: string }): Promise<ResumoCaixa>
  extrato(f: { hoje: string; limite: number; offset: number; busca?: string; lado?: FiltroLado }): Promise<{ itens: Movimento[]; total: number }>
  buscarManual(id: number): Promise<LancamentoManual | null>
  criarManual(d: NovoLancamento): Promise<LancamentoManual>
  atualizarManual(id: number, d: { tipo: TipoManual; valor: number; data: string; obs: string | null; lado: Lado }): Promise<LancamentoManual>
  excluirManual(id: number): Promise<void>
  /** O que entrou e saiu entre `de` e `ate` (mesmas regras do saldo: a partir do marco zero de cada lado), com a lista dos movimentos. */
  periodo(f: { de: string; ate: string; limite: number }): Promise<{ porLado: Record<FiltroLado, { entrou: number; saiu: number }>; itens: Movimento[]; total: number }>
}

const dia = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)
const MANUAIS: TipoManual[] = ['APORTE', 'RETIRADA', 'DESPESA']
const paraManual = (l: { id: number; tipo: TipoManual; valor: string; data: Date | string; obs: string | null; lado: Lado | null }): LancamentoManual => ({ id: l.id, tipo: l.tipo, valor: Number(l.valor), data: dia(l.data), obs: l.obs, lado: l.lado })

/** A forma de pagamento escrita para o extrato. */
const FORMA_SQL = `case t.forma_pagamento when 'PIX' then 'Pix' when 'DINHEIRO' then 'dinheiro' else 'cartão' end`
const E_ENTRADA_SQL = `exists (select 1 from recebimentos r where r.transacao_id = t.id and r.tipo = 'ENTRADA')`

/** "R$ 1.234,50" escrito no banco, para o extrato dizer quanto veio da conta do indicador. */
const BRL_SQL = (col: string) => `'R$ ' || replace(replace(replace(to_char(${col}, 'FM999,999,999,990.00'), ',', '#'), '.', ','), '#', '.')`

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
    null::int as manual_id,
    case when exists (select 1 from recebimentos r where r.transacao_id = t.id and r.emprestimo_parcela_id is not null) then 'EMPRESTIMO' else 'IPHONE' end as lado
  from transacoes_recebimento t join clientes c on c.id = t.cliente_id
  where t.desfeita_em is null and t.cobrado_por_indicador_id is null and t.data_recebimento <= :hoje
 union all
  select 'T' || m.id, m.data, m.valor, true, 'TRANSFERENCIA', 'Repasse do indicador · ' || coalesce(i.nome, 'indicador'), 'dinheiro que ele cobrou do cliente', null, m.lado
  from movimentacoes_caixa m left join indicadores i on i.id = m.indicador_id
  where m.tipo = 'TRANSFERENCIA_INDICADOR' and m.data <= :hoje
 union all
  select 'M' || m.id, m.data, m.valor, m.tipo = 'APORTE', m.tipo, coalesce(nullif(trim(m.obs), ''), case m.tipo when 'APORTE' then 'Aporte' when 'RETIRADA' then 'Retirada' else 'Despesa' end),
    case m.tipo when 'APORTE' then 'Aporte' when 'RETIRADA' then 'Retirada' else 'Despesa' end, m.id, m.lado
  from movimentacoes_caixa m where m.tipo in ('APORTE', 'RETIRADA', 'DESPESA') and m.data <= :hoje
 union all
  select 'P' || r.id, r.data_repasse, r.valor, false, 'REPASSE', 'Repasse · ' || i.nome, 'parte do lucro', null, null::text
  from repasses_indicador r join indicadores i on i.id = r.indicador_id where r.data_repasse <= :hoje
 union all
  select 'E' || e.id, e.data_emprestimo,
    e.capital + coalesce((select sum(a.capital_cedido - a.capital_adicional - a.capital_herdado) from acordos a where a.emprestimo_id = e.id), 0) - e.saiu_da_conta_valor,
    false, 'EMPRESTIMO', 'Empréstimo liberado · ' || c.nome,
    concat_ws(' · ', ${NOME_EMPRESTIMO_SQL}, case when e.saiu_da_conta_valor > 0 then ${BRL_SQL('e.saiu_da_conta_valor')} || ' da conta do indicador' end), null, 'EMPRESTIMO'
  from emprestimos e join clientes c on c.id = e.cliente_id where e.status <> 'CANCELADA' and e.data_emprestimo <= :hoje
    and e.capital + coalesce((select sum(a.capital_cedido - a.capital_adicional - a.capital_herdado) from acordos a where a.emprestimo_id = e.id), 0) - e.saiu_da_conta_valor > 0
 union all
  select 'D' || a.id, a.data_acordo, a.capital_adicional, false, 'EMPRESTIMO', 'Dinheiro novo no acordo · ' || c.nome, ${NOME_EMPRESTIMO_SQL}, null, 'EMPRESTIMO'
  from acordos a join emprestimos e on e.id = a.emprestimo_id join clientes c on c.id = e.cliente_id
  where a.capital_adicional > 0 and e.status <> 'CANCELADA' and a.data_acordo <= :hoje
 union all
  select 'B' || b.id, b.data_compra, b.valor_compra + b.custos_extras, false, 'COMPRA', 'Compra · ' || b.modelo || case when b.gb > 0 then ' ' || b.gb || ' GB' else '' end,
    case when b.cor = 'A DEFINIR' then '' else b.cor end, null, 'IPHONE'
  from bens b where b.origem = 'COMPRA' and b.estado <> 'ENCOMENDADO' and b.valor_compra + b.custos_extras > 0 and b.data_compra <= :hoje`

export function createCaixaRepository(db: Knex): CaixaRepository {
  /**
   * O marco zero de cada lado: antes do primeiro aporte/retirada daquele lado não existia saldo rastreado, então nada daquela época conta.
   * O lado que ainda não tem aporte nem retirada usa o primeiro de todos, assim o total não muda enquanto os lançamentos não são classificados.
   */
  const marcos = async (): Promise<{ geral: string | null; porLado: Record<FiltroLado, string | null> }> => {
    const ls = await db('movimentacoes_caixa').whereIn('tipo', ['APORTE', 'RETIRADA']).select<{ lado: Lado | null; d: Date | string }[]>(db.raw('lado, min(data) as d')).groupBy('lado')
    const proprio: Partial<Record<FiltroLado, string>> = {}
    let geral: string | null = null
    for (const l of ls) {
      const d = dia(l.d)
      proprio[l.lado ?? 'SEM_LADO'] = d
      if (!geral || d < geral) geral = d
    }
    return { geral, porLado: { EMPRESTIMO: proprio.EMPRESTIMO ?? geral, IPHONE: proprio.IPHONE ?? geral, SEM_LADO: proprio.SEM_LADO ?? geral } }
  }
  /** Os movimentos que contam: até hoje, a partir do marco zero de cada lado, e só do lado pedido (sem `lado`, de todos). */
  const contados = (hoje: string, m: Record<FiltroLado, string | null>, lado?: FiltroLado) =>
    db.from(db.raw(`(${UNIAO}) as m`, { hoje })).where((q) => {
      for (const l of FILTROS_LADO) {
        if (lado && lado !== l) continue
        q.orWhere((w) => { w.whereRaw("coalesce(m.lado, 'SEM_LADO') = ?", [l]); if (m[l]) w.whereRaw('m.data >= ?', [m[l]]) })
      }
    })

  return {
    async resumo(f) {
      const mc = await marcos()
      const rs = await contados(f.hoje, mc.porLado).select<{ lado: FiltroLado; saldo: string; entrou: string; saiu: string }[]>(
        db.raw("coalesce(m.lado, 'SEM_LADO') as lado"),
        db.raw('coalesce(sum(case when m.entrada then m.valor else -m.valor end), 0) as saldo'),
        db.raw('coalesce(sum(m.valor) filter (where m.entrada and m.data between ? and ?), 0) as entrou', [f.mesIni, f.mesFim]),
        db.raw('coalesce(sum(m.valor) filter (where not m.entrada and m.data between ? and ?), 0) as saiu', [f.mesIni, f.mesFim]),
      ).groupByRaw("coalesce(m.lado, 'SEM_LADO')")
      const porLado = Object.fromEntries(FILTROS_LADO.map((l) => [l, { saldo: 0, entrouMes: 0, saiuMes: 0, marcoZero: mc.porLado[l] }])) as Record<FiltroLado, SaldoLado>
      for (const r of rs) porLado[r.lado] = { saldo: Number(r.saldo), entrouMes: Number(r.entrou), saiuMes: Number(r.saiu), marcoZero: mc.porLado[r.lado] }
      const soma = (k: 'saldo' | 'entrouMes' | 'saiuMes') => FILTROS_LADO.reduce((t, l) => t + porLado[l][k], 0)
      return { saldo: soma('saldo'), marcoZero: mc.geral, entrouMes: soma('entrouMes'), saiuMes: soma('saiuMes'), porLado }
    },

    async extrato(f) {
      const mc = await marcos()
      const achados = () => filtrarPorTexto(contados(f.hoje, mc.porLado, f.lado), ['m.titulo', 'm.sub'], f.busca)
      const [{ n }] = await achados().select<{ n: string }[]>(db.raw('count(*) as n'))
      const ls = await achados().select<{ chave: string; data: Date | string; valor: string; entrada: boolean; categoria: Movimento['categoria']; titulo: string; sub: string; manual_id: number | null; lado: Lado | null }[]>('m.*')
        .orderByRaw('m.data desc, m.chave desc').limit(f.limite).offset(f.offset)
      return {
        total: Number(n),
        itens: ls.map((l) => ({ chave: l.chave, data: dia(l.data), valor: Number(l.valor), entrada: l.entrada, categoria: l.categoria, titulo: l.titulo, sub: l.sub, lado: l.lado, manualId: l.manual_id })),
      }
    },

    async periodo(f) {
      const mc = await marcos()
      const noPeriodo = () => contados(f.ate, mc.porLado).whereRaw('m.data >= ?', [f.de])
      const rs = await noPeriodo().select<{ lado: FiltroLado; entrou: string; saiu: string; n: string }[]>(
        db.raw("coalesce(m.lado, 'SEM_LADO') as lado"),
        db.raw('coalesce(sum(m.valor) filter (where m.entrada), 0) as entrou'),
        db.raw('coalesce(sum(m.valor) filter (where not m.entrada), 0) as saiu'),
        db.raw('count(*) as n'),
      ).groupByRaw("coalesce(m.lado, 'SEM_LADO')")
      const porLado = Object.fromEntries(FILTROS_LADO.map((l) => [l, { entrou: 0, saiu: 0 }])) as Record<FiltroLado, { entrou: number; saiu: number }>
      let total = 0
      for (const r of rs) { porLado[r.lado] = { entrou: Number(r.entrou), saiu: Number(r.saiu) }; total += Number(r.n) }
      const ls = await noPeriodo().select<{ chave: string; data: Date | string; valor: string; entrada: boolean; categoria: Movimento['categoria']; titulo: string; sub: string; manual_id: number | null; lado: Lado | null }[]>('m.*')
        .orderByRaw('m.data desc, m.chave desc').limit(f.limite)
      return { porLado, total, itens: ls.map((l) => ({ chave: l.chave, data: dia(l.data), valor: Number(l.valor), entrada: l.entrada, categoria: l.categoria, titulo: l.titulo, sub: l.sub, lado: l.lado, manualId: l.manual_id })) }
    },

    async buscarManual(id) {
      const l = await db('movimentacoes_caixa').where({ id }).whereIn('tipo', MANUAIS).first()
      return l ? paraManual(l) : null
    },
    async criarManual(d) {
      const [l] = await db('movimentacoes_caixa').insert({ tipo: d.tipo, valor: d.valor, data: d.data, obs: d.obs, lado: d.lado, usuario_id: d.usuarioId }).returning('*')
      return paraManual(l)
    },
    async atualizarManual(id, d) {
      const [l] = await db('movimentacoes_caixa').where({ id }).whereIn('tipo', MANUAIS).update({ tipo: d.tipo, valor: d.valor, data: d.data, obs: d.obs, lado: d.lado, updated_at: db.fn.now() }).returning('*')
      return paraManual(l)
    },
    async excluirManual(id) { await db('movimentacoes_caixa').where({ id }).whereIn('tipo', MANUAIS).del() },
  }
}
