import { criarSeed } from '@/data/seed'
import { aplicarEscopo } from '@/domain/escopo'
import type { Api } from './index'

export function criarApiFalsa(): Api {
  const base = criarSeed()
  return {
    async carregar(sessao) {
      return structuredClone(aplicarEscopo(base, sessao))
    },
  }
}
