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
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const exigirAdmin = (s: Sessao) => { if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador gerencia a equipe') }
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
      if (e.perfil !== 'VENDEDOR' && e.perfil !== 'COBRADOR') throw requisicaoInvalida('O perfil deve ser VENDEDOR ou COBRADOR')
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
      if (alvo.perfil === 'ADMIN') throw semPermissao('O administrador não é alterado por aqui')
      const antes = { ...alvo }
      if ('nome' in e) {
        if (typeof e.nome !== 'string' || e.nome.trim().length < 2 || e.nome.trim().length > 160) throw requisicaoInvalida('Informe o nome (ao menos 2 letras)')
      }
      const fone = 'fone' in e ? lerFone(e.fone) : undefined
      if ('ativo' in e && typeof e.ativo !== 'boolean') throw requisicaoInvalida('ativo deve ser verdadeiro ou falso')
      if (e.ativo === false && id === s.usuarioId) throw requisicaoInvalida('Você não pode desativar o seu próprio acesso')

      if ('nome' in e || fone !== undefined) await dep.repo.atualizar(id, { ...('nome' in e ? { nome: maiusculas(e.nome as string) } : {}), ...(fone !== undefined ? { fone } : {}) })
      if (typeof e.ativo === 'boolean' && e.ativo !== alvo.ativo) await dep.repo.definirAtivo(id, e.ativo)
      const depois = (await pessoas()).find((p) => p.id === id)!
      await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'EQUIPE_ALTERADO', entidade: 'usuario', entidadeId: id, antes: { nome: antes.nome, fone: antes.fone, ativo: antes.ativo }, depois: { nome: depois.nome, fone: depois.fone, ativo: depois.ativo } })
      return depois
    },
  }
}
