import { ErroApi } from './clientes'
import type { CaixaApi } from './caixa'

type Requisicao = (url: string, init?: RequestInit) => Promise<Response>

export function criarCaixaHttp(baseUrl: string, requisicao: Requisicao): CaixaApi {
  async function chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
    let r: Response
    try {
      r = await requisicao(`${baseUrl}/api${caminho}`, { ...init, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } })
    } catch {
      throw new ErroApi(0, 'Sem conexão com o servidor. Tente de novo.')
    }
    if (r.status === 204) return undefined as T
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) throw new ErroApi(r.status, corpo.erro ?? 'Algo deu errado. Tente de novo.', corpo.codigo)
    return corpo as T
  }
  const qs = (q: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(q)) if (v !== undefined) p.set(k, String(v))
    const s = p.toString()
    return s ? `?${s}` : ''
  }
  return {
    ver: (_s, q = {}) => chamar('/caixa' + qs(q)),
    lancar: (_s, e) => chamar('/caixa/movimentos', { method: 'POST', body: JSON.stringify(e) }),
    editar: (_s, id, e) => chamar(`/caixa/movimentos/${id}`, { method: 'PATCH', body: JSON.stringify(e) }),
    excluir: (_s, id) => chamar(`/caixa/movimentos/${id}`, { method: 'DELETE' }),
  }
}
