import { randomBytes } from 'node:crypto'
import { maiusculas } from '../../../shared/texto.js'
import { HttpError, naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import { normalizarFone } from '../../../shared/documentos.js'
import type { Sessao } from '../../../shared/perfis.js'
import { hojeBR } from '../../../shared/relogio.js'
import { somaMes } from '../../../shared/datas.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import { hashSenha } from '../../auth/services/password.js'
import type { EquipeRepository } from '../models/repository.js'
import type { Pessoa } from '../models/types.js'

export type Entrada = Record<string, unknown>

export type EquipeService = {
  listar(s: Sessao): Promise<Pessoa[]>
  convidar(s: Sessao, e: Entrada): Promise<{ id: number; email: string; senhaTemporaria: string }>
  atualizar(s: Sessao, id: number, e: Entrada): Promise<Pessoa>
  /** Troca a senha por uma temporária (mostrada uma vez); a pessoa troca no próximo acesso. */
  redefinirSenha(s: Sessao, id: number): Promise<{ id: number; email: string; senhaTemporaria: string }>
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const exigirAdmin = (s: Sessao) => { if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador gerencia a equipe') }
const CONFIRMAR_ADMIN = new HttpError(400, 'Confirme que esta pessoa terá acesso total ao sistema', 'CONFIRMAR_ADMIN')
const EMAIL_EM_USO = new HttpError(409, 'Já existe um usuário com esse e-mail', 'EMAIL_EM_USO')

export function createEquipeService(dep: { repo: EquipeRepository; auditoria: AuditoriaRepository; hoje?: () => string }): EquipeService {
  const hoje = dep.hoje ?? (() => hojeBR())
  const pessoas = () => {
    const h = hoje()
    const inicioMes = h.slice(0, 7) + '-01'
    return dep.repo.listar({ hoje: h, inicioMes, fimMes: somaMes(inicioMes, 1, 1) })
  }
  const lerFone = (v: unknown): string | null => {
    if (v === undefined || v === null || v === '') return null
    const f = typeof v === 'string' ? normalizarFone(v) : null
    if (!f) throw requisicaoInvalida('Telefone inválido. Use DDD + número, por exemplo (11) 98812-4410')
    return f
  }

  return {
    async listar(s) { exigirAdmin(s); return pessoas() },

    async convidar(s, e) {
      exigirAdmin(s)
      if (typeof e.nome !== 'string' || e.nome.trim().length < 2 || e.nome.trim().length > 160) throw requisicaoInvalida('Informe o nome (ao menos 2 letras)')
      const email = typeof e.email === 'string' ? e.email.trim().toLowerCase() : ''
      if (!EMAIL.test(email) || email.length > 255) throw requisicaoInvalida('E-mail inválido')
      if (e.perfil !== 'ADMIN' && e.perfil !== 'VENDEDOR' && e.perfil !== 'COBRADOR') throw requisicaoInvalida('O nível deve ser ADMIN, VENDEDOR ou COBRADOR')
      if (e.perfil === 'ADMIN' && e.confirmarAdmin !== true) throw CONFIRMAR_ADMIN
      const fone = lerFone(e.fone)
      // senha aleatória mostrada só nesta resposta; a pessoa é obrigada a trocar no primeiro acesso
      const senhaTemporaria = randomBytes(10).toString('base64url')
      let id: number
      try {
        id = await dep.repo.criar({ nome: maiusculas(e.nome), email, senhaHash: await hashSenha(senhaTemporaria), perfil: e.perfil, fone })
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw EMAIL_EM_USO
        throw err
      }
      await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'EQUIPE_CONVIDADO', entidade: 'usuario', entidadeId: id, depois: { email, perfil: e.perfil } })
      return { id, email, senhaTemporaria }
    },

    async atualizar(s, id, e) {
      exigirAdmin(s)
      const alvo = await dep.repo.buscar(id)
      if (!alvo) throw naoEncontrado('Pessoa não encontrada')
      // o acesso do indicador nasce e se edita em "Indicadores e repasses"; aqui só liga e desliga
      if (alvo.perfil === 'INDICADOR' && Object.keys(e).some((k) => k !== 'ativo')) throw requisicaoInvalida('Os dados do indicador são editados em Indicadores e repasses; aqui só dá para ativar ou desativar o acesso')
      const antes = { ...alvo }
      if ('nome' in e) {
        if (typeof e.nome !== 'string' || e.nome.trim().length < 2 || e.nome.trim().length > 160) throw requisicaoInvalida('Informe o nome (ao menos 2 letras)')
      }
      const fone = 'fone' in e ? lerFone(e.fone) : undefined
      if ('ativo' in e && typeof e.ativo !== 'boolean') throw requisicaoInvalida('ativo deve ser verdadeiro ou falso')
      if (e.ativo === false && id === s.usuarioId) throw requisicaoInvalida('Você não pode desativar o seu próprio acesso')
      let email: string | undefined
      if ('email' in e) {
        email = typeof e.email === 'string' ? e.email.trim().toLowerCase() : ''
        if (!EMAIL.test(email) || email.length > 255) throw requisicaoInvalida('E-mail inválido')
      }
      let perfil: 'VENDEDOR' | 'COBRADOR' | undefined
      if ('perfil' in e && e.perfil !== alvo.perfil) {
        if (id === s.usuarioId) throw requisicaoInvalida('Você não pode mudar o seu próprio nível')
        if ((e.perfil !== 'VENDEDOR' && e.perfil !== 'COBRADOR') || (alvo.perfil !== 'VENDEDOR' && alvo.perfil !== 'COBRADOR')) throw requisicaoInvalida('Só dá para trocar entre vendedor e cobrador')
        perfil = e.perfil
      }

      let indicadorIds: number[] | undefined
      if ('indicadorIds' in e) {
        if ((perfil ?? alvo.perfil) !== 'COBRADOR') throw requisicaoInvalida('Só o cobrador atende indicadores')
        const v = e.indicadorIds
        if (!Array.isArray(v) || v.length > 500 || !v.every((x) => typeof x === 'number' && Number.isInteger(x) && x > 0)) throw requisicaoInvalida('indicadorIds deve ser uma lista de números de indicadores')
        indicadorIds = [...new Set(v as number[])]
        if ((await dep.repo.indicadoresExistentes(indicadorIds)).length !== indicadorIds.length) throw requisicaoInvalida('Há indicador que não existe')
      }

      try {
        if ('nome' in e || fone !== undefined || email !== undefined) await dep.repo.atualizar(id, { ...('nome' in e ? { nome: maiusculas(e.nome as string) } : {}), ...(fone !== undefined ? { fone } : {}), ...(email !== undefined ? { email } : {}) })
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw EMAIL_EM_USO
        throw err
      }
      if (perfil) await dep.repo.definirPerfil(id, perfil)
      if (typeof e.ativo === 'boolean' && e.ativo !== alvo.ativo) await dep.repo.definirAtivo(id, e.ativo)
      const antesIndicadores = indicadorIds ? ((await pessoas()).find((p) => p.id === id)?.indicadorIds ?? []) : undefined
      if (indicadorIds) await dep.repo.definirIndicadores(id, indicadorIds)
      const depois = (await pessoas()).find((p) => p.id === id)!
      await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'EQUIPE_ALTERADO', entidade: 'usuario', entidadeId: id, antes: { nome: antes.nome, email: antes.email, perfil: antes.perfil, fone: antes.fone, ativo: antes.ativo, ...(antesIndicadores ? { indicadorIds: antesIndicadores } : {}) }, depois: { nome: depois.nome, email: depois.email, perfil: depois.perfil, fone: depois.fone, ativo: depois.ativo, ...(indicadorIds ? { indicadorIds } : {}) } })
      return depois
    },

    async redefinirSenha(s, id) {
      exigirAdmin(s)
      const alvo = await dep.repo.buscar(id)
      if (!alvo) throw naoEncontrado('Pessoa não encontrada')
      if (id === s.usuarioId) throw requisicaoInvalida('Para trocar a sua própria senha use a sua conta')
      const senhaTemporaria = randomBytes(10).toString('base64url')
      await dep.repo.redefinirSenha(id, await hashSenha(senhaTemporaria))
      await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'EQUIPE_SENHA_REDEFINIDA', entidade: 'usuario', entidadeId: id, depois: { email: alvo.email, perfil: alvo.perfil } })
      return { id, email: alvo.email, senhaTemporaria }
    },
  }
}
