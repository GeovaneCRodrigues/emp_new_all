import { semPermissao } from '../../../shared/errors.js'
import type { Sessao } from '../../../shared/perfis.js'
import type { ConfigRepository, Juros } from '../models/repository.js'

export type ConfigService = { juros(s: Sessao): Promise<Juros> }

export function createConfigService(repo: ConfigRepository): ConfigService {
  return {
    async juros(s) {
      // quem simula ou vende precisa saber os juros; o resto do sistema não
      if (s.perfil !== 'ADMIN' && s.perfil !== 'VENDEDOR') throw semPermissao('Você não tem acesso a esta configuração')
      return repo.juros()
    },
  }
}
