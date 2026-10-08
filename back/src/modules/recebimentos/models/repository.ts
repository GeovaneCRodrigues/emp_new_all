import type { Knex } from 'knex'
import type { Aba, EscopoRecebimentos, EstadoParcela, FormaPagamento, LinhaCobranca, PagamentoDaVenda, ParcelaAberta, ReciboRegistro, RecebimentoDaTransacao, ResultadoCobrancas, ResumoRecibo, TransacaoRegistro, VendaTravada } from './types.js'
import { addDia } from '../../../shared/datas.js'

/** Operações que precisam acontecer juntas, na mesma transação do banco. */
export interface RecebimentosTx {
  /** Trava a venda até o fim da transação: dois recebimentos da mesma venda não se atropelam. */
  travarVenda(id: number, escopo: EscopoRecebimentos): Promise<VendaTravada | null>
  parcelas(vendaId: number): Promise<ParcelaAberta[]>
  atualizarParcela(id: number, e: EstadoParcela): Promise<void>
  criarTransacao(d: { clienteId: number; valorTotal: number; forma: FormaPagamento; data: string; recebidoPor: number; resumo: ResumoRecibo }): Promise<{ id: number; numeroRecibo: number }>
  criarRecebimento(d: { transacaoId: number; vendaParcelaId: number; valor: number; antes: EstadoParcela }): Promise<void>
  definirStatusVenda(id: number, status: 'ATIVA' | 'QUITADA'): Promise<void>
  // desfazer
  travarTransacao(id: number): Promise<TransacaoRegistro | null>
  recebimentosDaTransacao(transacaoId: number): Promise<RecebimentoDaTransacao[]>
  /** É a transação de parcelas mais recente (não desfeita) desta venda? */
  ehUltimaDaVenda(vendaId: number, transacaoId: number): Promise<boolean>
  marcarDesfeita(id: number, usuarioId: number): Promise<void>
}

export interface RecebimentosRepository {
  emTransacao<T>(fn: (tx: RecebimentosTx) => Promise<T>): Promise<T>
  /** A venda que a transação paga (pelas parcelas), antes de abrir a transação de desfazer. */
  vendaDaTransacao(transacaoId: number): Promise<number | null>
  buscarRecibo(id: number): Promise<ReciboRegistro | null>
  /** Venda dentro do escopo (fora dele é como se não existisse). */
  vendaNoEscopo(vendaId: number, escopo: EscopoRecebimentos): Promise<{ id: number } | null>
  pagamentosDaVenda(vendaId: number): Promise<PagamentoDaVenda[]>
  cobrancas(escopo: EscopoRecebimentos, f: { aba: Aba; hoje: string; limite: number; offset: number }): Promise<ResultadoCobrancas>
  empresa(): Promise<{ nome: string; cnpj: string | null }>
}

const dia = (d: Date | string | null) => (d === null ? null : (typeof d === 'string' ? d : d.toISOString()).slice(0, 10))

type LinhaTransacao = { eh_entrada?: boolean; id: number; numero_recibo: number; cliente_id: number; valor_total: string; forma_pagamento: FormaPagamento; data_recebimento: Date | string; recebido_por: number | null; recebido_por_nome: string | null; desfeita_em: Date | null; resumo: ResumoRecibo | null }
const paraTransacao = (l: LinhaTransacao): TransacaoRegistro => ({
  id: l.id, numeroRecibo: l.numero_recibo, clienteId: l.cliente_id, valorTotal: Number(l.valor_total), forma: l.forma_pagamento, data: dia(l.data_recebimento)!,
  recebidoPor: l.recebido_por, recebidoPorNome: l.recebido_por_nome, desfeita: l.desfeita_em !== null, resumo: l.resumo,
})

const PAGO_SQL = `coalesce((select sum(r.valor) from recebimentos r join transacoes_recebimento t on t.id = r.transacao_id where r.venda_parcela_id = p.id and t.desfeita_em is null), 0)`

export function createRecebimentosRepository(db: Knex): RecebimentosRepository {
  const escopoSql = (q: Knex.QueryBuilder, e: EscopoRecebimentos) => { if (e.tipo === 'CARTEIRA') q.where('c.responsavel_id', e.usuarioId); return q }

  return {
    async emTransacao(fn) {
      return db.transaction(async (trx) => {
        const tx: RecebimentosTx = {
          async travarVenda(id, escopo) {
            // trava só a linha da venda (FOR UPDATE OF v); o resto é leitura
            const q = trx('vendas as v').join('clientes as c', 'c.id', 'v.cliente_id').join('bens as b', 'b.id', 'v.bem_id').where('v.id', id).forUpdate('v')
            escopoSql(q, escopo)
            const l = await q.first<{ id: number; cliente_id: number; status: VendaTravada['status']; data_venda: Date | string; nome: string; fone: string; modelo: string; n: string } | undefined>(
              'v.id', 'v.cliente_id', 'v.status', 'v.data_venda', 'c.nome as nome', 'c.fone as fone', 'b.modelo as modelo', trx.raw('(select count(*) from venda_parcelas x where x.venda_id = v.id) as n'),
            )
            return l ? { id: l.id, clienteId: l.cliente_id, clienteNome: l.nome, clienteFone: l.fone, status: l.status, dataVenda: dia(l.data_venda)!, modelo: l.modelo, nParcelas: Number(l.n) } : null
          },
          async parcelas(vendaId) {
            const ls = await trx('venda_parcelas as p').where('p.venda_id', vendaId).orderBy('p.numero').select<{ id: number; numero: number; vencimento: Date | string; vencimento_original: Date | string | null; valor: string; desconto: string; quitada_em: Date | string | null; pago: string }[]>('p.*', trx.raw(`${PAGO_SQL} as pago`))
            return ls.map((l) => ({ id: l.id, numero: l.numero, vencimento: dia(l.vencimento)!, vencimentoOriginal: dia(l.vencimento_original), valor: Number(l.valor), desconto: Number(l.desconto), pago: Number(l.pago), quitadaEm: dia(l.quitada_em) }))
          },
          async atualizarParcela(id, e) {
            await trx('venda_parcelas').where({ id }).update({ vencimento: e.vencimento, vencimento_original: e.vencimentoOriginal, desconto: e.desconto, quitada_em: e.quitadaEm, updated_at: trx.fn.now() })
          },
          async criarTransacao(d) {
            const [{ n }] = (await trx.raw("select nextval('recibo_numero_seq') as n")).rows
            const [{ id }] = await trx('transacoes_recebimento').insert({
              numero_recibo: Number(n), cliente_id: d.clienteId, valor_total: d.valorTotal, forma_pagamento: d.forma, data_recebimento: d.data, recebido_por: d.recebidoPor, resumo: JSON.stringify(d.resumo),
            }).returning('id')
            return { id, numeroRecibo: Number(n) }
          },
          async criarRecebimento(d) {
            await trx('recebimentos').insert({ transacao_id: d.transacaoId, tipo: 'PARCELA', venda_parcela_id: d.vendaParcelaId, valor: d.valor, antes: JSON.stringify(d.antes) })
          },
          async definirStatusVenda(id, status) {
            await trx('vendas').where({ id }).update({ status, updated_at: trx.fn.now() })
          },
          async travarTransacao(id) {
            const l = await trx('transacoes_recebimento as t').leftJoin('users as u', 'u.id', 't.recebido_por').where('t.id', id).forUpdate('t')
              .first<LinhaTransacao | undefined>('t.*', 'u.nome as recebido_por_nome')
            return l ? paraTransacao(l) : null
          },
          async recebimentosDaTransacao(transacaoId) {
            const ls = await trx('recebimentos as r').join('venda_parcelas as p', 'p.id', 'r.venda_parcela_id').where('r.transacao_id', transacaoId).orderBy('p.numero')
              .select<{ id: number; venda_parcela_id: number; numero: number; venda_id: number; valor: string; antes: EstadoParcela | null }[]>('r.id', 'r.venda_parcela_id', 'p.numero', 'p.venda_id', 'r.valor', 'r.antes')
            return ls.map((l) => ({ id: l.id, vendaParcelaId: l.venda_parcela_id, numero: l.numero, vendaId: l.venda_id, valor: Number(l.valor), antes: l.antes }))
          },
          async ehUltimaDaVenda(vendaId, transacaoId) {
            const r = await trx('transacoes_recebimento as t').join('recebimentos as r', 'r.transacao_id', 't.id').join('venda_parcelas as p', 'p.id', 'r.venda_parcela_id')
              .where('p.venda_id', vendaId).whereNull('t.desfeita_em').max<{ max: number | null }>('t.id as max').first()
            return r?.max === transacaoId
          },
          async marcarDesfeita(id, usuarioId) {
            await trx('transacoes_recebimento').where({ id }).update({ desfeita_em: trx.fn.now(), desfeita_por: usuarioId, updated_at: trx.fn.now() })
          },
        }
        return fn(tx)
      })
    },

    async vendaDaTransacao(transacaoId) {
      const r = await db('recebimentos as r').join('venda_parcelas as p', 'p.id', 'r.venda_parcela_id').where('r.transacao_id', transacaoId).first<{ venda_id: number } | undefined>('p.venda_id')
      return r?.venda_id ?? null
    },

    async buscarRecibo(id) {
      const l = await db('transacoes_recebimento as t').join('clientes as c', 'c.id', 't.cliente_id').leftJoin('users as u', 'u.id', 't.recebido_por').where('t.id', id)
        .first<(LinhaTransacao & { cliente_nome: string; cliente_fone: string; responsavel_id: number | null }) | undefined>('t.*', 'u.nome as recebido_por_nome', 'c.nome as cliente_nome', 'c.fone as cliente_fone', 'c.responsavel_id', db.raw("exists (select 1 from recebimentos r where r.transacao_id = t.id and r.tipo = 'ENTRADA') as eh_entrada"))
      if (!l) return null
      // a venda e o aparelho: pelas parcelas pagas ou, na entrada, pelo recebimento da venda
      const v = await db('recebimentos as r').leftJoin('venda_parcelas as p', 'p.id', 'r.venda_parcela_id').join('vendas as v', 'v.id', db.raw('coalesce(r.venda_id, p.venda_id)')).join('bens as b', 'b.id', 'v.bem_id')
        .where('r.transacao_id', id).first<{ venda_id: number; modelo: string } | undefined>('v.id as venda_id', 'b.modelo')
      return { ...paraTransacao(l), tipo: l.eh_entrada ? ('ENTRADA' as const) : ('PARCELA' as const), vendaId: v?.venda_id ?? null, clienteNome: l.cliente_nome, clienteFone: l.cliente_fone, modelo: v?.modelo ?? '', responsavelId: l.responsavel_id }
    },

    async vendaNoEscopo(vendaId, escopo) {
      const q = db('vendas as v').join('clientes as c', 'c.id', 'v.cliente_id').where('v.id', vendaId)
      escopoSql(q, escopo)
      return (await q.first<{ id: number } | undefined>('v.id')) ?? null
    },

    async pagamentosDaVenda(vendaId) {
      const ls = await db('transacoes_recebimento as t').leftJoin('users as u', 'u.id', 't.recebido_por')
        .whereIn('t.id', db('recebimentos as r').leftJoin('venda_parcelas as p', 'p.id', 'r.venda_parcela_id').where(db.raw('coalesce(r.venda_id, p.venda_id) = ?', [vendaId])).select('r.transacao_id'))
        .orderBy('t.id', 'desc').select<LinhaTransacao[]>('t.*', 'u.nome as recebido_por_nome', db.raw("exists (select 1 from recebimentos r where r.transacao_id = t.id and r.tipo = 'ENTRADA') as eh_entrada"))
      // entrada ou parcela vem do tipo real do recebimento, não do retrato (que pode faltar em dados antigos)
      return ls.map((l) => ({ ...paraTransacao(l), tipo: l.eh_entrada ? ('ENTRADA' as const) : ('PARCELA' as const) }))
    },

    async cobrancas(escopo, f) {
      const base = () => {
        const q = db('venda_parcelas as p').join('vendas as v', 'v.id', 'p.venda_id').join('clientes as c', 'c.id', 'v.cliente_id').join('bens as b', 'b.id', 'v.bem_id')
          .whereNotIn('v.status', ['RETOMADA', 'CANCELADA'])
        escopoSql(q, escopo)
        return q
      }
      const falta = `(p.valor - ${PAGO_SQL} - p.desconto)`
      const ultima = `(select max(t.id) from recebimentos r join transacoes_recebimento t on t.id = r.transacao_id where r.venda_parcela_id = p.id and t.desfeita_em is null)`
      const ultimaData = `(select max(t.data_recebimento) from recebimentos r join transacoes_recebimento t on t.id = r.transacao_id where r.venda_parcela_id = p.id and t.desfeita_em is null)`
      const h = f.hoje, mais7 = addDia(h, 7), mais8 = addDia(h, 8), mais45 = addDia(h, 45), menos30 = addDia(h, -30)
      const filtroAba = (q: Knex.QueryBuilder) => {
        if (f.aba === 'atrasadas') q.whereRaw(`${falta} > 0.009 and p.vencimento < ?`, [h])
        else if (f.aba === 'hoje') q.whereRaw(`${falta} > 0.009 and p.vencimento between ? and ?`, [h, mais7])
        else if (f.aba === 'proximas') q.whereRaw(`${falta} > 0.009 and p.vencimento between ? and ?`, [mais8, mais45])
        else q.whereRaw(`${ultimaData} >= ?`, [menos30])
        return q
      }
      const [soma] = await filtroAba(base()).select<{ n: string; total: string }[]>(db.raw('count(*) as n'), db.raw(f.aba === 'recebidas' ? `coalesce(sum(${PAGO_SQL}), 0) as total` : `coalesce(sum(${falta}), 0) as total`))
      const ordem = f.aba === 'recebidas' ? `${ultimaData} desc, p.id desc` : 'p.vencimento asc, p.id asc'
      const ls = await filtroAba(base()).select<{ venda_id: number; numero: number; n_parcelas: string; vencimento: Date | string; vencimento_original: Date | string | null; valor: string; desconto: string; pago: string; falta: string; cliente_id: number; cliente_nome: string; cliente_fone: string; modelo: string; ultima: number | null; ultima_data: Date | string | null }[]>(
        'p.numero', 'p.vencimento', 'p.vencimento_original', 'p.valor', 'p.desconto', 'v.id as venda_id', 'c.id as cliente_id', 'c.nome as cliente_nome', 'c.fone as cliente_fone', 'b.modelo',
        db.raw('(select count(*) from venda_parcelas x where x.venda_id = v.id) as n_parcelas'), db.raw(`${PAGO_SQL} as pago`), db.raw(`${falta} as falta`), db.raw(`${ultima} as ultima`), db.raw(`${ultimaData} as ultima_data`),
      ).orderByRaw(ordem).limit(f.limite).offset(f.offset)
      const [c] = await base().select<{ atrasadas: string; hoje: string; proximas: string }[]>(
        db.raw(`count(*) filter (where ${falta} > 0.009 and p.vencimento < ?) as atrasadas`, [h]),
        db.raw(`count(*) filter (where ${falta} > 0.009 and p.vencimento between ? and ?) as hoje`, [h, mais7]),
        db.raw(`count(*) filter (where ${falta} > 0.009 and p.vencimento between ? and ?) as proximas`, [mais8, mais45]),
      )
      const itens: LinhaCobranca[] = ls.map((l) => ({
        vendaId: l.venda_id, numero: l.numero, nParcelas: Number(l.n_parcelas), vencimento: dia(l.vencimento)!, vencimentoOriginal: dia(l.vencimento_original), valor: Number(l.valor),
        pago: Number(l.pago), falta: Number(l.falta), cliente: { id: l.cliente_id, nome: l.cliente_nome, fone: l.cliente_fone }, modelo: l.modelo, ultimaTransacaoId: l.ultima, ultimoRecebimentoEm: dia(l.ultima_data),
      }))
      return { itens, total: Number(soma.n), valorTotal: Number(soma.total), contagens: { atrasadas: Number(c.atrasadas), hoje: Number(c.hoje), proximas: Number(c.proximas) } }
    },

    async empresa() {
      const ls = await db('sistema_config').whereIn('chave', ['empresa_nome', 'empresa_cnpj']).select<{ chave: string; valor: unknown }[]>('chave', 'valor')
      const nome = ls.find((l) => l.chave === 'empresa_nome')?.valor
      const cnpj = ls.find((l) => l.chave === 'empresa_cnpj')?.valor
      return { nome: typeof nome === 'string' && nome ? nome : 'Mundo dos iPhones', cnpj: typeof cnpj === 'string' && cnpj ? cnpj : null }
    },
  }
}
