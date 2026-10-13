import type { Relatorios } from '@/domain/relatorios'
import type { Sessao } from '@/domain/escopo'

export type RelatoriosDados = Relatorios

export interface RelatoriosApi {
  /** Todos os relatórios de uma vez (só o administrador). */
  ver(s: Sessao): Promise<RelatoriosDados>
}
