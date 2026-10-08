import type { Bem, Cliente, ConfigJuros, Emprestimo, Indicador, Iso, RepasseIndicador, Usuario, Venda } from './types'

export type { Bem, Cliente }

/** O que a API devolve para a tela (já filtrado pelo perfil de quem pediu). */
export interface Dados {
  hoje: Iso
  bens: Bem[]
  clientes: Cliente[]
  indicadores: Indicador[]
  vendas: Venda[]
  emprestimos: Emprestimo[]
  usuarios: Usuario[]
  repasses: RepasseIndicador[]
  juros: ConfigJuros
}
