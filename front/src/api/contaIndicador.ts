import type { Sessao } from '@/domain/escopo'

export type TipoLinhaContaApi = 'COBROU' | 'ENVIOU' | 'EMPRESTIMO'
export interface LinhaContaApi { chave: string; data: string; valor: number; tipo: TipoLinhaContaApi; titulo: string; sub: string }
export interface ContaIndicadorApi { indicador: { id: number; nome: string }; saldo: number; cobrou: number; enviou: number; emprestou: number; itens: LinhaContaApi[]; total: number; pagina: number; limite: number }
export interface SaldoIndicadorApi { indicador: { id: number; nome: string; ativo: boolean }; saldo: number }
export interface EntradaEnvio { valor: number; data?: string; comprovante?: string; lado?: 'EMPRESTIMO' | 'IPHONE' }
export interface ContasIndicadorApi {
  saldos(s: Sessao): Promise<SaldoIndicadorApi[]>
  ver(s: Sessao, indicadorId: number, q?: { pagina?: number; limite?: number }): Promise<ContaIndicadorApi>
  lancarEnvio(s: Sessao, indicadorId: number, e: EntradaEnvio): Promise<ContaIndicadorApi>
}
