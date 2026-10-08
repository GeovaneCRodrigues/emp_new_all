import type { Knex } from 'knex'

export type Juros = { pct: number; maxParcelas: number }

export interface ConfigRepository {
  juros(): Promise<Juros>
}

export function createConfigRepository(db: Knex): ConfigRepository {
  return {
    async juros() {
      const ls = await db('sistema_config').whereIn('chave', ['juros_parcela_pct', 'max_parcelas']).select<{ chave: string; valor: unknown }[]>('chave', 'valor')
      const v = (c: string, padrao: number) => { const x = ls.find((l) => l.chave === c)?.valor; return typeof x === 'number' && Number.isFinite(x) ? x : padrao }
      return { pct: v('juros_parcela_pct', 10), maxParcelas: v('max_parcelas', 10) }
    },
  }
}
