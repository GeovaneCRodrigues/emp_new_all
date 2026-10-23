/** O que cada linha do extrato é: o indicador ficou com dinheiro de cliente, enviou à loja, ou o dinheiro dele pagou um empréstimo. */
export type TipoLinhaConta = 'COBROU' | 'ENVIOU' | 'EMPRESTIMO'

export type LinhaConta = { chave: string; data: string; valor: number; tipo: TipoLinhaConta; titulo: string; sub: string }

export type ResumoConta = { saldo: number; cobrou: number; enviou: number; emprestou: number }

export type ContaIndicador = ResumoConta & {
  indicador: { id: number; nome: string }
  itens: LinhaConta[]
  total: number
  pagina: number
  limite: number
}

export type SaldoIndicador = { indicador: { id: number; nome: string; ativo: boolean }; saldo: number }
