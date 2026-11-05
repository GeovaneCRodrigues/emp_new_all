import { ErroApi } from './clientes'
import type { PushApi } from './push'

type Requisicao = (url: string, init?: RequestInit) => Promise<Response>

export function criarPushHttp(baseUrl: string, requisicao: Requisicao): PushApi {
  async function chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
    let r: Response
    try {
      r = await requisicao(`${baseUrl}/api${caminho}`, { ...init, headers: { 'content-type': 'application/json', ...init.headers } })
    } catch {
      throw new ErroApi(0, 'Sem conexão com o servidor. Tente de novo.')
    }
    if (r.status === 204) return undefined as T
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) throw new ErroApi(r.status, corpo.erro ?? 'Algo deu errado. Tente de novo.', corpo.codigo)
    return corpo as T
  }
  return {
    config: () => chamar('/push/config'),
    inscrever: (i) => chamar('/push/inscricao', { method: 'POST', body: JSON.stringify(i) }),
    cancelar: (endpoint) => chamar('/push/inscricao', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
    testar: () => chamar('/push/teste', { method: 'POST' }),
  }
}
