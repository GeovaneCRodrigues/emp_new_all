import type { Knex } from 'knex'
import type { Perfil } from '../../../shared/perfis.js'

export type Notificacao = { id: number; tipo: string; texto: string; rota: string | null; lida: boolean; criadaEm: string }
export type NovaNotificacao = { usuarioId: number; tipo: string; texto: string; rota: string | null; chave: string }
export type FatoAuditado = { id: number; usuarioId: number | null; acao: string; entidade: string; entidadeId: number; depois: Record<string, unknown> | null }

export interface NotificacoesRepository {
  /** Quem recebe avisos de cada perfil (só usuários ativos). */
  usuariosAtivos(perfis: Perfil[]): Promise<{ id: number; perfil: Perfil }[]>
  /** Não repete: se a pessoa já tem um aviso com essa chave, nada acontece (e devolve false). */
  inserir(n: NovaNotificacao): Promise<boolean>
  listar(usuarioId: number, limite: number): Promise<Notificacao[]>
  naoLidas(usuarioId: number): Promise<number>
  marcarLida(id: number, usuarioId: number): Promise<boolean>
  marcarTodas(usuarioId: number): Promise<number>
  estado(chave: string): Promise<number | null>
  gravarEstado(chave: string, valor: number): Promise<void>
  ultimaAuditoria(): Promise<number>
  auditoriaApos(id: number, acoes: string[], limite: number): Promise<FatoAuditado[]>
  /** Cliente de um contrato / de uma venda / de um empréstimo, para escrever o aviso. */
  contrato(id: number): Promise<{ numero: string; cliente: string } | null>
  clienteDaOperacao(entidade: 'venda' | 'emprestimo', id: number): Promise<string | null>
}

type Linha = { id: number; tipo: string; texto: string; rota: string | null; lida: boolean; criada_em: Date }

export function createNotificacoesRepository(db: Knex): NotificacoesRepository {
  return {
    async usuariosAtivos(perfis) {
      const l = await db('users').whereIn('perfil', perfis).where({ ativo: true }).select('id', 'perfil')
      return l as { id: number; perfil: Perfil }[]
    },
    async inserir(n) {
      const novos = await db('notificacoes')
        .insert({ usuario_id: n.usuarioId, tipo: n.tipo, texto: n.texto, rota: n.rota, chave: n.chave })
        .onConflict(['usuario_id', 'chave']).ignore().returning('id')
      return novos.length > 0
    },
    async listar(usuarioId, limite) {
      const l: Linha[] = await db('notificacoes').where({ usuario_id: usuarioId }).orderBy('id', 'desc').limit(limite)
      return l.map((n) => ({ id: n.id, tipo: n.tipo, texto: n.texto, rota: n.rota, lida: n.lida, criadaEm: n.criada_em.toISOString() }))
    },
    async naoLidas(usuarioId) {
      const r = await db('notificacoes').where({ usuario_id: usuarioId, lida: false }).count<{ n: string }[]>({ n: '*' })
      return Number(r[0].n)
    },
    async marcarLida(id, usuarioId) {
      return (await db('notificacoes').where({ id, usuario_id: usuarioId }).update({ lida: true })) > 0
    },
    async marcarTodas(usuarioId) {
      return db('notificacoes').where({ usuario_id: usuarioId, lida: false }).update({ lida: true })
    },
    async estado(chave) {
      const r = await db('notificacoes_estado').where({ chave }).first('valor')
      return r ? Number(r.valor) : null
    },
    async gravarEstado(chave, valor) {
      await db('notificacoes_estado').insert({ chave, valor }).onConflict('chave').merge()
    },
    async ultimaAuditoria() {
      const r = await db('auditoria').max<{ m: string | null }[]>({ m: 'id' })
      return Number(r[0].m ?? 0)
    },
    async auditoriaApos(id, acoes, limite) {
      const l = await db('auditoria').where('id', '>', id).whereIn('acao', acoes).orderBy('id').limit(limite)
        .select('id', 'usuario_id', 'acao', 'entidade', 'entidade_id', 'depois')
      return l.map((a: { id: number; usuario_id: number | null; acao: string; entidade: string; entidade_id: number; depois: unknown }) => ({
        id: Number(a.id), usuarioId: a.usuario_id, acao: a.acao, entidade: a.entidade, entidadeId: Number(a.entidade_id),
        depois: typeof a.depois === 'string' ? JSON.parse(a.depois) : (a.depois as Record<string, unknown> | null),
      }))
    },
    async contrato(id) {
      const r = await db('contratos as c').join('vendas as v', 'v.id', 'c.venda_id').join('clientes as cl', 'cl.id', 'v.cliente_id').where('c.id', id).first('c.numero', 'cl.nome')
      return r ? { numero: r.numero, cliente: r.nome } : null
    },
    async clienteDaOperacao(entidade, id) {
      const r = await db(entidade === 'venda' ? 'vendas as o' : 'emprestimos as o').join('clientes as cl', 'cl.id', 'o.cliente_id').where('o.id', id).first('cl.nome')
      return r ? r.nome : null
    },
  }
}
