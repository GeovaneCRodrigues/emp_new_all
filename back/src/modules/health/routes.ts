import type { FastifyInstance } from 'fastify'
import type { Db } from '../../db/connection.js'

export function healthRoutes(db: Pick<Db, 'ping'>) {
  return async (app: FastifyInstance) => {
    app.get('/health', async (_req, reply) => {
      try {
        await db.ping()
        return { status: 'ok' }
      } catch {
        return reply.code(503).send({ status: 'indisponivel' })
      }
    })
  }
}
