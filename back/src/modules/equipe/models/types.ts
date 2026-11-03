export type PerfilEquipe = 'ADMIN' | 'VENDEDOR' | 'COBRADOR' | 'INDICADOR'

export type Pessoa = {
  id: number
  nome: string
  email: string
  perfil: PerfilEquipe
  fone: string | null
  ativo: boolean
  /** clientes na carteira (cobrador: os dos indicadores marcados) */
  carteira: number
  /** clientes da carteira com parcela vencida e em aberto */
  comAtraso: number
  /** dinheiro recebido no mês (transações não desfeitas) */
  recebidoNoMes: number
  /** vendas feitas no mês (vendedor) */
  vendasNoMes: number
  /** pedidos de desconto esperando o administrador */
  pedidosPendentes: number
  /** cobrador: os indicadores que ele atende (só o que vem deles aparece para ele) */
  indicadorIds?: number[]
  /** último login (ISO) ou null se nunca entrou */
  ultimoAcesso: string | null
  /** conta travada por excesso de tentativas de senha */
  bloqueado: boolean
  /** ainda não trocou a senha temporária */
  senhaTemporaria: boolean
}
