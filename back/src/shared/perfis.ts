export const PERFIS = ['ADMIN', 'VENDEDOR', 'COBRADOR', 'INDICADOR'] as const
export type Perfil = (typeof PERFIS)[number]

/** Quem está fazendo o pedido. Todo endpoint filtra por isso no backend, não só na tela. */
export type Sessao = {
  /** id da linha em `sessoes`: é o que o logout revoga */
  sessaoId: string
  usuarioId: number
  perfil: Perfil
  /** preenchido quando o perfil é INDICADOR */
  indicadorId: number | null
}
