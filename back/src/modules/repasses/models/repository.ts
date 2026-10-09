import type { Knex } from 'knex'

export type FormaRepasse = 'PIX' | 'DINHEIRO' | 'TRANSFERENCIA'

export type RepasseRegistro = {
  id: number
  indicadorId: number
  indicadorNome: string
  valor: number
  data: string
  forma: FormaRepasse
  obs: string | null
  feitoPor: string | null
}

export type NovoRepasse = { valor: number; data: string; forma: FormaRepasse; obs: string | null; usuarioId: number }

/** O que dá para fazer com o indicador travado (dois repasses ao mesmo tempo esperam um pelo outro). */
export interface RepasseTx {
  totalPago(): Promise<number>
  inserir(d: NovoRepasse): Promise<RepasseRegistro>
}

export interface RepassesRepository {
  /** Quanto já foi pago a cada indicador (id → total). */
  totaisPagos(): Promise<Map<number, number>>
  listar(filtro: { indicadorId?: number; limite: number }): Promise<RepasseRegistro[]>
  comTrava<T>(indicadorId: number, fn: (tx: RepasseTx) => Promise<T>): Promise<T>
}

type Linha = { id: number; indicador_id: number; nome_indicador: string; valor: string; data_repasse: Date | string; forma_pagamento: FormaRepasse; obs: string | null; nome_usuario: string | null }
const dia = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)
const paraRegistro = (l: Linha): RepasseRegistro => ({
  id: l.id, indicadorId: l.indicador_id, indicadorNome: l.nome_indicador, valor: Number(l.valor), data: dia(l.data_repasse), forma: l.forma_pagamento, obs: l.obs, feitoPor: l.nome_usuario,
})

export function createRepassesRepository(db: Knex): RepassesRepository {
  const base = (k: Knex | Knex.Transaction) =>
    k('repasses_indicador as r').join('indicadores as i', 'i.id', 'r.indicador_id').leftJoin('users as u', 'u.id', 'r.usuario_id')
      .select<Linha[]>('r.id', 'r.indicador_id', 'i.nome as nome_indicador', 'r.valor', 'r.data_repasse', 'r.forma_pagamento', 'r.obs', 'u.nome as nome_usuario')

  return {
    async totaisPagos() {
      const ls = await db('repasses_indicador').groupBy('indicador_id').select<{ indicador_id: number; total: string }[]>('indicador_id', db.raw('sum(valor) as total'))
      return new Map(ls.map((l) => [l.indicador_id, Number(l.total)]))
    },
    async listar({ indicadorId, limite }) {
      const q = base(db).orderBy([{ column: 'r.data_repasse', order: 'desc' }, { column: 'r.id', order: 'desc' }]).limit(limite)
      if (indicadorId) q.where('r.indicador_id', indicadorId)
      return (await q).map(paraRegistro)
    },
    async comTrava(indicadorId, fn) {
      return db.transaction(async (trx) => {
        await trx.raw('select pg_advisory_xact_lock(?, ?)', [7002, indicadorId])
        return fn({
          async totalPago() {
            const l = await trx('repasses_indicador').where({ indicador_id: indicadorId }).first<{ total: string | null }>(trx.raw('sum(valor) as total'))
            return Number(l?.total ?? 0)
          },
          async inserir(d) {
            const [{ id }] = await trx('repasses_indicador').insert({ indicador_id: indicadorId, valor: d.valor, data_repasse: d.data, forma_pagamento: d.forma, obs: d.obs, usuario_id: d.usuarioId }).returning('id')
            return paraRegistro((await base(trx).where('r.id', id).first())!)
          },
        })
      })
    },
  }
}
