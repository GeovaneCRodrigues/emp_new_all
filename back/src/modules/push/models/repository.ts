import type { Knex } from 'knex'

export type Inscricao = { id: number; endpoint: string; p256dh: string; auth: string }
export type NovaInscricao = { usuarioId: number; endpoint: string; p256dh: string; auth: string; userAgent: string | null }

export interface PushRepository {
  /** O endpoint é único por aparelho: se outra pessoa entrou nele, a inscrição passa para ela. */
  salvar(i: NovaInscricao): Promise<void>
  remover(usuarioId: number, endpoint: string): Promise<void>
  doUsuario(usuarioId: number): Promise<Inscricao[]>
  apagar(id: number): Promise<void>
}

export function createPushRepository(db: Knex): PushRepository {
  return {
    async salvar(i) {
      await db('push_inscricoes')
        .insert({ usuario_id: i.usuarioId, endpoint: i.endpoint, p256dh: i.p256dh, auth: i.auth, user_agent: i.userAgent })
        .onConflict('endpoint').merge({ usuario_id: i.usuarioId, p256dh: i.p256dh, auth: i.auth, user_agent: i.userAgent })
    },
    async remover(usuarioId, endpoint) { await db('push_inscricoes').where({ usuario_id: usuarioId, endpoint }).del() },
    async doUsuario(usuarioId) { return db('push_inscricoes').where({ usuario_id: usuarioId }).select('id', 'endpoint', 'p256dh', 'auth') },
    async apagar(id) { await db('push_inscricoes').where({ id }).del() },
  }
}
