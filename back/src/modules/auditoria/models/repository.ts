import type { Knex } from 'knex'

export type RegistroAuditoria = {
  usuarioId: number
  acao: string
  entidade: string
  entidadeId: number
  antes?: unknown
  depois?: unknown
}

/** Quem fez o quê, com o antes e o depois. */
export interface AuditoriaRepository {
  registrar(r: RegistroAuditoria): Promise<void>
}

export function createAuditoriaRepository(db: Knex): AuditoriaRepository {
  return {
    async registrar(r) {
      await db('auditoria').insert({
        usuario_id: r.usuarioId, acao: r.acao, entidade: r.entidade, entidade_id: r.entidadeId,
        antes: r.antes === undefined ? null : JSON.stringify(r.antes),
        depois: r.depois === undefined ? null : JSON.stringify(r.depois),
      })
    },
  }
}
