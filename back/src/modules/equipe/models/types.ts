export type PerfilEquipe = 'ADMIN' | 'VENDEDOR' | 'COBRADOR'

export type Pessoa = {
  id: number
  nome: string
  email: string
  perfil: PerfilEquipe
  fone: string | null
  ativo: boolean
  /** clientes na carteira */
  carteira: number
  /** clientes da carteira com parcela vencida e em aberto */
  comAtraso: number
  /** dinheiro recebido no mês (transações não desfeitas) */
  recebidoNoMes: number
  /** vendas feitas no mês (vendedor) */
  vendasNoMes: number
  /** pedidos de desconto esperando o administrador */
  pedidosPendentes: number
}
