export interface EntradaAltura {
  /** aberto pelo ícone da Tela de Início (não no Safari) */
  instalado: boolean
  ios: boolean
  /** celular em pé (o app é só em pé) */
  emPe: boolean
  /** altura da tela do aparelho em px de CSS (screen.height) */
  telaAltura: number
  /** altura que o navegador diz ter para a página (innerHeight) */
  janelaAltura: number
}

/**
 * No app instalado do iPhone o navegador calcula a altura da página sem a área da barra de status, mas desenha por baixo dela:
 * o `100%`, o `100dvh` e o `fixed; bottom: 0` ficam ~60px curtos e sobra uma faixa embaixo do menu.
 * Devolve a altura (px) que o app deve ter para chegar ao fim da tela, ou null quando não é o caso (aí vale o CSS normal).
 */
export function alturaDoApp(e: EntradaAltura): number | null {
  if (!e.instalado || !e.ios || !e.emPe) return null
  const h = Math.max(e.telaAltura, e.janelaAltura)
  return Number.isFinite(h) && h > 0 ? Math.round(h) : null
}
