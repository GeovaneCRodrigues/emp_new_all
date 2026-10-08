import type { Knex } from 'knex'
import type { Perfil } from '../../../shared/perfis.js'

export type UsuarioResumo = { id: number; nome: string; perfil: Perfil }

export interface UsuariosListaRepository {
  /** Quem pode ter carteira de clientes: usuários ativos que não são indicadores. */
  listarResponsaveis(): Promise<UsuarioResumo[]>
}

export function createUsuariosListaRepository(db: Knex): UsuariosListaRepository {
  return {
    async listarResponsaveis() {
      return db('users').where({ ativo: true }).whereNot({ perfil: 'INDICADOR' }).orderByRaw('lower(nome)').select<UsuarioResumo[]>('id', 'nome', 'perfil')
    },
  }
}
