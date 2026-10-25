import type { Knex } from 'knex'
import type { FechamentoLoja } from './types.js'

export interface CaixaFechamentosRepository {
  /** o mais recente primeiro */
  listar(limite: number): Promise<FechamentoLoja[]>
  ultimo(): Promise<FechamentoLoja | null>
  buscar(id: number): Promise<FechamentoLoja | null>
  criar(d: { dia: string; obs: string | null; usuarioId: number }): Promise<FechamentoLoja>
  excluir(id: number): Promise<void>
}

const dia = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)
type Linha = { id: number; dia: Date | string; obs: string | null; por: string; created_at: Date }
const paraFechamento = (l: Linha): FechamentoLoja => ({ id: l.id, dia: dia(l.dia), obs: l.obs, por: l.por, criadoEm: l.created_at.toISOString() })

export function createCaixaFechamentosRepository(db: Knex): CaixaFechamentosRepository {
  const base = () => db('fechamentos_caixa_loja as f').join('users as u', 'u.id', 'f.usuario_id').select<Linha[]>('f.id', 'f.dia', 'f.obs', 'f.created_at', 'u.nome as por')
  return {
    async listar(limite) { return (await base().orderBy('f.id', 'desc').limit(limite)).map(paraFechamento) },
    async ultimo() {
      const l = await base().orderBy('f.id', 'desc').first()
      return l ? paraFechamento(l) : null
    },
    async buscar(id) {
      const l = await base().where('f.id', id).first()
      return l ? paraFechamento(l) : null
    },
    async criar(d) {
      const [{ id }] = await db('fechamentos_caixa_loja').insert({ dia: d.dia, obs: d.obs, usuario_id: d.usuarioId }).returning('id')
      return (await this.buscar(id))!
    },
    async excluir(id) { await db('fechamentos_caixa_loja').where({ id }).del() },
  }
}
