import type { Dados } from '@/domain/dados'
import type { Sessao } from '@/domain/escopo'

/**
 * Contrato com o backend. Hoje a implementação é a API falsa (`fake.ts`); depois ela
 * é trocada pela API real (sistema_emprestimos/backend) sem mexer nas telas.
 */
export interface Api {
  /** Dados já filtrados pelo perfil de quem pede (o backend faz esse filtro em todo endpoint). */
  carregar(sessao: Sessao): Promise<Dados>
}
