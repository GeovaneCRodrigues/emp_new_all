import type { Knex } from 'knex'
import { NOME_EMPRESTIMO_SQL } from '../../../shared/sql.js'
import type { LinhaConta, ResumoConta, SaldoIndicador, TipoLinhaConta } from './types.js'

export interface ContaIndicadorRepository {
  indicador(id: number): Promise<{ id: number; nome: string; ativo: boolean } | null>
  resumo(indicadorId: number, hoje: string): Promise<ResumoConta>
  extrato(indicadorId: number, f: { hoje: string; limite: number; offset: number }): Promise<{ itens: LinhaConta[]; total: number }>
  saldos(hoje: string): Promise<SaldoIndicador[]>
  /** O indicador enviou dinheiro à loja: entra no Caixa (como "Repasse do indicador") e baixa o saldo dele. */
  lancarEnvio(d: { indicadorId: number; valor: number; data: string; comprovante: string | null; lado: 'EMPRESTIMO' | 'IPHONE' | null; usuarioId: number }): Promise<void>
}

const dia = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)

/**
 * Tudo o que mexe na conta do indicador, uma linha por lançamento. `deve` = true aumenta o que ele deve à loja.
 *  COBROU: recebimento que ficou com ele (não desfeito)  ·  ENVIOU: transferência dele à loja  ·  EMPRESTIMO: empréstimo pago com a conta dele (não cancelado)
 */
const UNIAO = `
  select 'C' || t.id as chave, t.cobrado_por_indicador_id as ind, t.data_recebimento as data, t.valor_total as valor, true as deve, 'COBROU' as tipo,
    c.nome as titulo, coalesce(t.resumo->>'referencia', 'recebimento') as sub
  from transacoes_recebimento t join clientes c on c.id = t.cliente_id
  where t.cobrado_por_indicador_id is not null and t.desfeita_em is null and t.data_recebimento <= :hoje
 union all
  select 'T' || m.id, m.indicador_id, m.data, m.valor, false, 'ENVIOU', 'Enviou para a loja', coalesce(nullif(trim(m.obs), ''), 'transferência')
  from movimentacoes_caixa m where m.tipo = 'TRANSFERENCIA_INDICADOR' and m.indicador_id is not null and m.data <= :hoje
 union all
  select 'E' || e.id, e.saiu_da_conta_indicador_id, e.data_emprestimo, e.saiu_da_conta_valor, false, 'EMPRESTIMO', 'Empréstimo · ' || c.nome, ${NOME_EMPRESTIMO_SQL}
  from emprestimos e join clientes c on c.id = e.cliente_id
  where e.saiu_da_conta_indicador_id is not null and e.saiu_da_conta_valor > 0 and e.status <> 'CANCELADA' and e.data_emprestimo <= :hoje`

const dele = (db: Knex, hoje: string) => db.from(db.raw(`(${UNIAO}) as m`, { hoje }))

export function createContaIndicadorRepository(db: Knex): ContaIndicadorRepository {
  return {
    async indicador(id) {
      const l = await db('indicadores').where({ id }).first<{ id: number; nome: string; ativo: boolean } | undefined>('id', 'nome', 'ativo')
      return l ?? null
    },

    async resumo(indicadorId, hoje) {
      const l = await dele(db, hoje).where('m.ind', indicadorId).first<{ cobrou: string; enviou: string; emprestou: string }>(
        db.raw("coalesce(sum(m.valor) filter (where m.tipo = 'COBROU'), 0) as cobrou"),
        db.raw("coalesce(sum(m.valor) filter (where m.tipo = 'ENVIOU'), 0) as enviou"),
        db.raw("coalesce(sum(m.valor) filter (where m.tipo = 'EMPRESTIMO'), 0) as emprestou"),
      )
      const cobrou = Number(l!.cobrou), enviou = Number(l!.enviou), emprestou = Number(l!.emprestou)
      return { cobrou, enviou, emprestou, saldo: Math.round((cobrou - enviou - emprestou) * 100) / 100 }
    },

    async extrato(indicadorId, f) {
      const [{ n }] = await dele(db, f.hoje).where('m.ind', indicadorId).select<{ n: string }[]>(db.raw('count(*) as n'))
      const ls = await dele(db, f.hoje).where('m.ind', indicadorId).select<{ chave: string; data: Date | string; valor: string; tipo: TipoLinhaConta; titulo: string; sub: string }[]>('m.chave', 'm.data', 'm.valor', 'm.tipo', 'm.titulo', 'm.sub')
        .orderByRaw('m.data desc, m.chave desc').limit(f.limite).offset(f.offset)
      return { total: Number(n), itens: ls.map((l) => ({ chave: l.chave, data: dia(l.data), valor: Number(l.valor), tipo: l.tipo, titulo: l.titulo, sub: l.sub })) }
    },

    async saldos(hoje) {
      const somas = await dele(db, hoje).groupBy('m.ind').select<{ ind: number; saldo: string }[]>('m.ind', db.raw('sum(case when m.deve then m.valor else -m.valor end) as saldo'))
      const por = new Map(somas.map((s) => [s.ind, Math.round(Number(s.saldo) * 100) / 100]))
      const is = await db('indicadores').orderBy('nome').select<{ id: number; nome: string; ativo: boolean }[]>('id', 'nome', 'ativo')
      return is.map((i) => ({ indicador: { id: i.id, nome: i.nome, ativo: i.ativo }, saldo: por.get(i.id) ?? 0 }))
    },

    async lancarEnvio(d) {
      await db('movimentacoes_caixa').insert({ tipo: 'TRANSFERENCIA_INDICADOR', valor: d.valor, data: d.data, obs: d.comprovante, usuario_id: d.usuarioId, indicador_id: d.indicadorId, lado: d.lado })
    },
  }
}
