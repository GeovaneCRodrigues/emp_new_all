import type { Knex } from 'knex'
import type { Fechamento, RecebimentoDoDia, StatusFechamento, Totais } from './types.js'

export interface FechamentosRepository {
  /** O que o cobrador recebeu num dia (transações não desfeitas), somado por forma de pagamento. */
  totais(usuarioId: number, data: string): Promise<Totais>
  recebimentos(usuarioId: number, data: string): Promise<RecebimentoDoDia[]>
  buscarDoDia(usuarioId: number, data: string): Promise<Fechamento | null>
  /** Fecha o dia: trava o caixa do cobrador, soma o que ele recebeu e grava. Lança 23505 se já fechou. */
  fechar(usuarioId: number, data: string): Promise<Fechamento>
  listar(f: { usuarioId?: number; status?: StatusFechamento; limite: number; offset: number }): Promise<{ itens: Fechamento[]; total: number; pendentes: number }>
  buscar(id: number): Promise<Fechamento | null>
  /** Marca como conferido só se ainda está pendente. */
  conferir(id: number, adminId: number): Promise<boolean>
  /** Reabre (apaga) só se ainda está pendente. */
  reabrir(id: number): Promise<boolean>
}

type Linha = { id: number; usuario_id: number; usuario_nome: string; data: Date | string; total_dinheiro: string; total_pix: string; total_cartao: string; status: StatusFechamento; conferente: string | null; conferido_em: Date | null }
const dia = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)
const arred = (v: number) => Math.round(v * 100) / 100
const paraFechamento = (l: Linha): Fechamento => {
  const d = Number(l.total_dinheiro), p = Number(l.total_pix), c = Number(l.total_cartao)
  return { id: l.id, usuario: { id: l.usuario_id, nome: l.usuario_nome }, data: dia(l.data), totalDinheiro: d, totalPix: p, totalCartao: c, total: arred(d + p + c), status: l.status, conferidoPor: l.conferente, conferidoEm: l.conferido_em ? l.conferido_em.toISOString() : null }
}

export function createFechamentosRepository(db: Knex): FechamentosRepository {
  const base = () => db('fechamentos_caixa as f').join('users as u', 'u.id', 'f.usuario_id').leftJoin('users as c', 'c.id', 'f.conferido_por')
  const colunas = (q: Knex.QueryBuilder) => q.select<Linha[]>('f.id', 'f.usuario_id', 'u.nome as usuario_nome', 'f.data', 'f.total_dinheiro', 'f.total_pix', 'f.total_cartao', 'f.status', 'c.nome as conferente', 'f.conferido_em')

  async function somar(k: Knex | Knex.Transaction, usuarioId: number, data: string): Promise<Totais> {
    const ls = await k('transacoes_recebimento').where({ recebido_por: usuarioId, data_recebimento: data }).whereNull('desfeita_em').groupBy('forma_pagamento').select<{ forma_pagamento: string; soma: string }[]>('forma_pagamento', k.raw('sum(valor_total) as soma'))
    const v = (f: string) => arred(Number(ls.find((l) => l.forma_pagamento === f)?.soma ?? 0))
    return { dinheiro: v('DINHEIRO'), pix: v('PIX'), cartao: v('CARTAO') }
  }

  return {
    totais: (u, d) => somar(db, u, d),
    async recebimentos(usuarioId, data) {
      const ls = await db('transacoes_recebimento as t').join('clientes as c', 'c.id', 't.cliente_id').where({ 't.recebido_por': usuarioId, 't.data_recebimento': data }).whereNull('t.desfeita_em').orderBy('t.id', 'desc')
        .select<{ id: number; numero_recibo: number; nome: string; valor_total: string; forma_pagamento: RecebimentoDoDia['forma']; resumo: { referencia?: string } | null }[]>('t.id', 't.numero_recibo', 'c.nome', 't.valor_total', 't.forma_pagamento', 't.resumo')
      return ls.map((l) => ({ transacaoId: l.id, numero: String(l.numero_recibo).padStart(6, '0'), cliente: l.nome, valor: Number(l.valor_total), forma: l.forma_pagamento, referencia: l.resumo?.referencia ?? 'pagamento' }))
    },
    async buscarDoDia(usuarioId, data) {
      const l = await colunas(base().where({ 'f.usuario_id': usuarioId, 'f.data': data })).first()
      return l ? paraFechamento(l) : null
    },
    async fechar(usuarioId, data) {
      return db.transaction(async (trx) => {
        // mesma trava que o recebimento do cobrador usa: ninguém recebe enquanto o dia está sendo somado e fechado
        await trx.raw('select pg_advisory_xact_lock(?, ?)', [7001, usuarioId])
        const t = await somar(trx, usuarioId, data)
        const [{ id }] = await trx('fechamentos_caixa').insert({ usuario_id: usuarioId, data, total_dinheiro: t.dinheiro, total_pix: t.pix, total_cartao: t.cartao }).returning('id')
        const l = await colunas(trx('fechamentos_caixa as f').join('users as u', 'u.id', 'f.usuario_id').leftJoin('users as c', 'c.id', 'f.conferido_por').where('f.id', id)).first()
        return paraFechamento(l!)
      })
    },
    async listar(f) {
      const filtrar = (q: Knex.QueryBuilder) => { if (f.usuarioId) q.where('f.usuario_id', f.usuarioId); if (f.status) q.where('f.status', f.status); return q }
      const [{ n }] = await filtrar(base()).count<{ n: string }[]>({ n: '*' })
      const pend = base().where('f.status', 'PENDENTE'); if (f.usuarioId) pend.where('f.usuario_id', f.usuarioId)
      const [{ n: p }] = await pend.count<{ n: string }[]>({ n: '*' })
      const ls = await colunas(filtrar(base())).orderByRaw("(f.status = 'PENDENTE') desc, f.data desc, f.id desc").limit(f.limite).offset(f.offset)
      return { itens: ls.map(paraFechamento), total: Number(n), pendentes: Number(p) }
    },
    async buscar(id) {
      const l = await colunas(base().where('f.id', id)).first()
      return l ? paraFechamento(l) : null
    },
    async conferir(id, adminId) {
      return (await db('fechamentos_caixa').where({ id, status: 'PENDENTE' }).update({ status: 'CONFERIDO', conferido_por: adminId, conferido_em: db.fn.now(), updated_at: db.fn.now() })) === 1
    },
    async reabrir(id) {
      return (await db('fechamentos_caixa').where({ id, status: 'PENDENTE' }).del()) === 1
    },
  }
}
