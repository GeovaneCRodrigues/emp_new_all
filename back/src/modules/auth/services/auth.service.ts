import { HttpError, naoAutenticado, requisicaoInvalida } from '../../../shared/errors.js'
import type { Sessao } from '../../../shared/perfis.js'
import type { SessoesRepository, UsuariosRepository } from '../models/repository.js'
import type { SessaoRegistro, Usuario } from '../models/types.js'
import { conferirSenha, hashFalso, hashSenha } from './password.js'
import { hashesIguais, hashRefresh, lerRefresh, montarRefresh, novoSegredoRefresh, type TokensService } from './tokens.js'

export type Contexto = { ip: string | null; userAgent: string | null }
export type Credenciais = { accessToken: string; refreshToken: string; expiraEm: Date; usuario: Usuario }

export type AuthOpcoes = {
  /** quantas falhas seguidas travam a conta */
  limiteFalhas?: number
  /** por quanto tempo a conta fica travada */
  bloqueioMs?: number
  refreshTtlMs?: number
  agora?: () => Date
}

export const SENHA_MIN = 10

export type AuthService = {
  login(email: string, senha: string, ctx: Contexto): Promise<Credenciais>
  /** Troca o refresh token por um novo par. O antigo deixa de valer; reapresentá-lo revoga a sessão. */
  renovar(refreshToken: string, ctx: Contexto): Promise<Credenciais>
  logout(sessaoId: string): Promise<void>
  logoutTodas(usuarioId: number): Promise<void>
  /** A sessão do token de acesso ainda vale? (revogada, expirada ou conta desativada = não) */
  validarSessao(s: Sessao): Promise<Usuario>
  listarSessoes(usuarioId: number): Promise<SessaoRegistro[]>
  trocarSenha(s: Sessao, atual: string, nova: string): Promise<void>
}

export function createAuthService(users: UsuariosRepository, sessoes: SessoesRepository, tokens: TokensService, opcoes: AuthOpcoes = {}): AuthService {
  const limiteFalhas = opcoes.limiteFalhas ?? 5
  const bloqueioMs = opcoes.bloqueioMs ?? 15 * 60_000
  const refreshTtlMs = opcoes.refreshTtlMs ?? 7 * 24 * 3600_000
  const agora = opcoes.agora ?? (() => new Date())

  const contaTravada = new HttpError(423, 'Conta temporariamente bloqueada por excesso de tentativas. Tente de novo em alguns minutos.', 'CONTA_BLOQUEADA')

  async function abrirSessao(u: Usuario, ctx: Contexto): Promise<Credenciais> {
    const segredo = novoSegredoRefresh()
    const expiraEm = new Date(agora().getTime() + refreshTtlMs)
    const reg = await sessoes.criar({ usuarioId: u.id, refreshHash: hashRefresh(segredo), expiraEm, ip: ctx.ip, userAgent: ctx.userAgent })
    return {
      accessToken: tokens.emitirAcesso({ sessaoId: reg.id, usuarioId: u.id, perfil: u.perfil, indicadorId: u.indicadorId }),
      refreshToken: montarRefresh(reg.id, segredo),
      expiraEm,
      usuario: u,
    }
  }

  return {
    async login(email, senha, ctx) {
      const u = await users.buscarPorEmail(email.trim())
      if (u?.bloqueadoAte && u.bloqueadoAte > agora()) throw contaTravada
      // sempre confere um hash, existindo a conta ou não, para a resposta demorar igual
      const ok = await conferirSenha(u?.senhaHash ?? (await hashFalso()), senha)
      if (!u || !ok || !u.ativo) {
        if (u) await users.registrarFalha(u.id, limiteFalhas, new Date(agora().getTime() + bloqueioMs))
        throw naoAutenticado('E-mail ou senha incorretos')
      }
      if (u.falhasLogin > 0) await users.zerarFalhas(u.id)
      return abrirSessao(u, ctx)
    },

    async renovar(refreshToken, ctx) {
      const t = lerRefresh(refreshToken)
      if (!t) throw naoAutenticado('Sessão inválida ou expirada')
      const reg = await sessoes.buscar(t.sessaoId)
      if (!reg || reg.revogadaEm || reg.expiraEm <= agora()) throw naoAutenticado('Sessão inválida ou expirada')

      const h = hashRefresh(t.segredo)
      if (!hashesIguais(h, reg.refreshHash)) {
        // token antigo reapresentado: alguém ficou com uma cópia. Derruba a sessão inteira.
        if (reg.refreshHashAnterior && hashesIguais(h, reg.refreshHashAnterior)) await sessoes.revogar(reg.id)
        throw naoAutenticado('Sessão inválida ou expirada')
      }

      const u = await users.buscarPorId(reg.usuarioId)
      if (!u || !u.ativo) { await sessoes.revogar(reg.id); throw naoAutenticado('Sessão inválida ou expirada') }

      const segredo = novoSegredoRefresh()
      const expiraEm = new Date(agora().getTime() + refreshTtlMs)
      await sessoes.rotacionar(reg.id, hashRefresh(segredo), reg.refreshHash, expiraEm)
      return {
        accessToken: tokens.emitirAcesso({ sessaoId: reg.id, usuarioId: u.id, perfil: u.perfil, indicadorId: u.indicadorId }),
        refreshToken: montarRefresh(reg.id, segredo),
        expiraEm,
        usuario: u,
      }
    },

    async logout(sessaoId) { await sessoes.revogar(sessaoId) },
    async logoutTodas(usuarioId) { await sessoes.revogarTodas(usuarioId) },

    async validarSessao(s) {
      const reg = await sessoes.buscar(s.sessaoId)
      if (!reg || reg.revogadaEm || reg.expiraEm <= agora() || reg.usuarioId !== s.usuarioId) throw naoAutenticado('Sessão inválida ou expirada')
      const u = await users.buscarPorId(s.usuarioId)
      // o perfil vem do banco, não do token: mudou de perfil ou foi desativado, vale na hora
      if (!u || !u.ativo || u.perfil !== s.perfil) throw naoAutenticado('Sessão inválida ou expirada')
      return u
    },

    listarSessoes: (usuarioId) => sessoes.listarAtivas(usuarioId),

    async trocarSenha(s, atual, nova) {
      if (nova.length < SENHA_MIN) throw requisicaoInvalida(`A nova senha precisa ter ao menos ${SENHA_MIN} caracteres`)
      if (nova === atual) throw requisicaoInvalida('A nova senha precisa ser diferente da atual')
      const u = await users.buscarPorId(s.usuarioId)
      if (!u || !(await conferirSenha(u.senhaHash, atual))) throw naoAutenticado('Senha atual incorreta')
      await users.atualizarSenha(u.id, await hashSenha(nova))
      // quem tinha a senha antiga perde o acesso; esta sessão continua
      await sessoes.revogarTodas(u.id, s.sessaoId)
    },
  }
}
