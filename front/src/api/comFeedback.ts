import { useCarregando } from '@/composables/useCarregando'
import { useToast } from '@/composables/useToast'

/** Consultas que usam POST mas não gravam nada, e o que roda sem o usuário pedir: nada de "enviando" nem "feito". */
const SILENCIOSAS = [/\/api\/auth\//, /\/api\/notificacoes/, /\/previa(\?|$)/]

/** Esta chamada é uma ação do usuário (grava algo)? Consultas (GET) e as chamadas silenciosas ficam de fora. */
export function ehAcao(metodo: string, url: string): boolean {
  const m = metodo.toUpperCase()
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false
  return !SILENCIOSAS.some((r) => r.test(url))
}

async function mensagemDoErro(r: Response): Promise<string> {
  const corpo = await r.clone().json().catch(() => null)
  return typeof corpo?.erro === 'string' && corpo.erro ? corpo.erro : 'Algo deu errado. Tente de novo.'
}

/**
 * O padrão de toda ação enviada à API: "enviando…" que trava a tela e, na volta, um toast (verde se deu certo, vermelho se não).
 * Uma tela que tem uma mensagem mais específica é só mostrar o próprio toast depois: ele substitui este.
 */
export async function comFeedback(metodo: string, url: string, enviar: () => Promise<Response>): Promise<Response> {
  if (!ehAcao(metodo, url)) return enviar()
  const fim = useCarregando().iniciar()
  const toast = useToast()
  try {
    const r = await enviar()
    if (r.ok) toast.ok(metodo.toUpperCase() === 'DELETE' ? 'Removido.' : 'Feito.')
    else if (r.status !== 401) toast.erro(await mensagemDoErro(r)) // 401: a sessão acabou e o app já leva para o login
    return r
  } catch (e) {
    toast.erro('Sem conexão com o servidor. Tente de novo.')
    throw e
  } finally {
    fim()
  }
}
