import { getCurrentScope, onScopeDispose } from 'vue'

/**
 * Repete `fn` a cada `ms` enquanto a aba está visível (o "atualiza sozinho"). Ao voltar para a aba, roda na hora.
 * Para sozinho quando o componente sai da tela. Erros de `fn` são engolidos: a tela segue com o que já tinha.
 */
export function usePulso(fn: () => unknown, ms = 30_000) {
  let timer: ReturnType<typeof setInterval> | undefined
  const rodar = () => { try { Promise.resolve(fn()).catch(() => undefined) } catch { /* segue com o que já tinha */ } }
  const parar = () => { if (timer !== undefined) { clearInterval(timer); timer = undefined } }
  const iniciar = () => { if (timer === undefined) timer = setInterval(rodar, ms) }
  const visibilidade = () => { if (document.visibilityState === 'visible') { rodar(); iniciar() } else parar() }
  if (document.visibilityState === 'visible') iniciar()
  document.addEventListener('visibilitychange', visibilidade)
  const fim = () => { parar(); document.removeEventListener('visibilitychange', visibilidade) }
  if (getCurrentScope()) onScopeDispose(fim)
  return fim
}
