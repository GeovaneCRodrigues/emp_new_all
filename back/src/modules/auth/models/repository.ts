import type { Knex } from 'knex'
import type { SessaoRegistro, Usuario } from './types.js'

/** Acesso ao banco dos usuários e das sessões (o "M" do MVC). Os services só conhecem estas interfaces. */
export interface UsuariosRepository {
  buscarPorEmail(email: string): Promise<Usuario | null>
  buscarPorId(id: number): Promise<Usuario | null>
  criar(dados: Pick<Usuario, 'nome' | 'email' | 'senhaHash' | 'perfil' | 'indicadorId' | 'ativo'>): Promise<Usuario>
  /** soma uma falha e, se passou do limite, bloqueia até `bloquearAte` */
  registrarFalha(id: number, limite: number, bloquearAte: Date): Promise<void>
  zerarFalhas(id: number): Promise<void>
  atualizarSenha(id: number, senhaHash: string): Promise<void>
}

export interface SessoesRepository {
  criar(d: { usuarioId: number; refreshHash: string; expiraEm: Date; ip: string | null; userAgent: string | null }): Promise<SessaoRegistro>
  buscar(id: string): Promise<SessaoRegistro | null>
  /** troca o refresh token, guardando o anterior para detectar reuso */
  rotacionar(id: string, novoHash: string, anterior: string, expiraEm: Date): Promise<void>
  revogar(id: string): Promise<void>
  /** revoga todas as sessões do usuário, menos `exceto` */
  revogarTodas(usuarioId: number, exceto?: string): Promise<void>
  listarAtivas(usuarioId: number): Promise<SessaoRegistro[]>
}

type LinhaUsuario = {
  id: number; nome: string; email: string; senha_hash: string; perfil: Usuario['perfil']; indicador_id: number | null
  ativo: boolean; falhas_login: number; bloqueado_ate: Date | null
}
const paraUsuario = (l: LinhaUsuario): Usuario => ({
  id: l.id, nome: l.nome, email: l.email, senhaHash: l.senha_hash, perfil: l.perfil, indicadorId: l.indicador_id,
  ativo: l.ativo, falhasLogin: l.falhas_login, bloqueadoAte: l.bloqueado_ate,
})

export function createUsuariosRepository(db: Knex): UsuariosRepository {
  return {
    async buscarPorEmail(email) {
      const l = await db<LinhaUsuario>('users').whereRaw('lower(email) = ?', [email.toLowerCase()]).first()
      return l ? paraUsuario(l) : null
    },
    async buscarPorId(id) {
      const l = await db<LinhaUsuario>('users').where({ id }).first()
      return l ? paraUsuario(l) : null
    },
    async criar(d) {
      const [l] = await db<LinhaUsuario>('users')
        .insert({ nome: d.nome, email: d.email.toLowerCase(), senha_hash: d.senhaHash, perfil: d.perfil, indicador_id: d.indicadorId, ativo: d.ativo })
        .returning('*')
      return paraUsuario(l)
    },
    async registrarFalha(id, limite, bloquearAte) {
      // uma instrução só: duas tentativas ao mesmo tempo não perdem a contagem
      await db.raw(
        `update users set falhas_login = falhas_login + 1,
           bloqueado_ate = case when falhas_login + 1 >= ? then ? else bloqueado_ate end
         where id = ?`,
        [limite, bloquearAte, id],
      )
    },
    async zerarFalhas(id) {
      await db('users').where({ id }).update({ falhas_login: 0, bloqueado_ate: null })
    },
    async atualizarSenha(id, senhaHash) {
      await db('users').where({ id }).update({ senha_hash: senhaHash, senha_alterada_em: db.fn.now(), updated_at: db.fn.now() })
    },
  }
}

type LinhaSessao = {
  id: string; usuario_id: number; refresh_hash: string; refresh_hash_anterior: string | null; expira_em: Date
  revogada_em: Date | null; ip: string | null; user_agent: string | null; criada_em: Date; ultimo_uso_em: Date
}
const paraSessao = (l: LinhaSessao): SessaoRegistro => ({
  id: l.id, usuarioId: l.usuario_id, refreshHash: l.refresh_hash, refreshHashAnterior: l.refresh_hash_anterior, expiraEm: l.expira_em,
  revogadaEm: l.revogada_em, ip: l.ip, userAgent: l.user_agent, criadaEm: l.criada_em, ultimoUsoEm: l.ultimo_uso_em,
})

export function createSessoesRepository(db: Knex): SessoesRepository {
  return {
    async criar(d) {
      const [l] = await db<LinhaSessao>('sessoes')
        .insert({ usuario_id: d.usuarioId, refresh_hash: d.refreshHash, expira_em: d.expiraEm, ip: d.ip, user_agent: d.userAgent?.slice(0, 300) ?? null })
        .returning('*')
      return paraSessao(l)
    },
    async buscar(id) {
      const l = await db<LinhaSessao>('sessoes').where({ id }).first()
      return l ? paraSessao(l) : null
    },
    async rotacionar(id, novoHash, anterior, expiraEm) {
      await db('sessoes').where({ id }).update({ refresh_hash: novoHash, refresh_hash_anterior: anterior, expira_em: expiraEm, ultimo_uso_em: db.fn.now() })
    },
    async revogar(id) {
      await db('sessoes').where({ id }).whereNull('revogada_em').update({ revogada_em: db.fn.now() })
    },
    async revogarTodas(usuarioId, exceto) {
      const q = db('sessoes').where({ usuario_id: usuarioId }).whereNull('revogada_em')
      if (exceto) q.whereNot({ id: exceto })
      await q.update({ revogada_em: db.fn.now() })
    },
    async listarAtivas(usuarioId) {
      const ls = await db<LinhaSessao>('sessoes').where({ usuario_id: usuarioId }).whereNull('revogada_em').where('expira_em', '>', db.fn.now()).orderBy('ultimo_uso_em', 'desc')
      return ls.map(paraSessao)
    },
  }
}
