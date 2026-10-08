import { semPermissao } from '../../../shared/errors.js'
import type { Sessao } from '../../../shared/perfis.js'
import type { UsuariosListaRepository } from '../models/repository.js'

export type UsuariosService = { responsaveis(s: Sessao): ReturnType<UsuariosListaRepository['listarResponsaveis']> }

export function createUsuariosService(repo: UsuariosListaRepository): UsuariosService {
  return {
    async responsaveis(s) {
      if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador vê a equipe')
      return repo.listarResponsaveis()
    },
  }
}
