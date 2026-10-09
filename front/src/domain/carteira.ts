import { arred2 } from './format'

export interface OperacaoCarteira {
  tipo: 'VENDA' | 'EMPRESTIMO'
  id: number
  clienteId: number
  descricao: string
  status: string
  falta: number
  atrasadas: number
}

export type SituacaoCliente = 'ATRASO' | 'EM_DIA' | 'SEM_DIVIDA'

export interface ClienteCarteira<C extends { id: number }> {
  cliente: C
  operacoes: OperacaoCarteira[]
  atrasadas: number
  saldo: number
  situacao: SituacaoCliente
}

/**
 * Monta a carteira: cada cliente com as operações dele. Só conta o que está em andamento (venda retomada ou
 * cancelada e operação quitada não devem). Atrasado = tem parcela atrasada; em dia = deve, mas nada atrasado.
 * Mais atrasadas primeiro, depois o maior saldo.
 */
export function montarCarteira<C extends { id: number; nome: string }>(clientes: C[], operacoes: OperacaoCarteira[]): ClienteCarteira<C>[] {
  return clientes
    .map((cliente) => {
      const ops = operacoes.filter((o) => o.clienteId === cliente.id)
      const vivas = ops.filter((o) => o.status === 'ATIVA')
      const atrasadas = vivas.reduce((s, o) => s + o.atrasadas, 0)
      const saldo = arred2(vivas.reduce((s, o) => s + o.falta, 0))
      const situacao: SituacaoCliente = atrasadas > 0 ? 'ATRASO' : saldo > 0.009 ? 'EM_DIA' : 'SEM_DIVIDA'
      return { cliente, operacoes: ops, atrasadas, saldo, situacao }
    })
    .sort((a, b) => b.atrasadas - a.atrasadas || b.saldo - a.saldo || a.cliente.nome.localeCompare(b.cliente.nome, 'pt-BR'))
}

export type FiltroCarteira = 'TODOS' | 'ATRASO' | 'EM_DIA'

export const noFiltro = <C extends { id: number }>(c: ClienteCarteira<C>, f: FiltroCarteira) => f === 'TODOS' || (f === 'ATRASO' ? c.situacao === 'ATRASO' : c.situacao === 'EM_DIA')

/** Sem acento e sem maiúscula, para a busca por nome. */
export const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
