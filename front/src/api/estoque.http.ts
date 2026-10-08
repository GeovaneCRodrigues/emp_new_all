import { ErroApi } from './clientes'
import type { EstoqueApi } from './estoque'

type Requisicao = (url: string, init?: RequestInit) => Promise<Response>

export function criarEstoqueHttp(baseUrl: string, requisicao: Requisicao): EstoqueApi {
  async function chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
    let r: Response
    try {
      r = await requisicao(`${baseUrl}/api${caminho}`, { ...init, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } })
    } catch {
      throw new ErroApi(0, 'Sem conexão com o servidor. Tente de novo.')
    }
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) throw new ErroApi(r.status, corpo.erro ?? 'Algo deu errado. Tente de novo.', corpo.codigo)
    return corpo as T
  }
  const qs = (q: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v))
    const s = p.toString()
    return s ? `?${s}` : ''
  }
  return {
    listar: (_s, q) => chamar('/aparelhos' + qs(q)),
    resumo: () => chamar('/aparelhos/resumo'),
    obter: (_s, id) => chamar(`/aparelhos/${id}`),
    criar: (_s, e) => chamar('/aparelhos', { method: 'POST', body: JSON.stringify(e) }),
    atualizar: (_s, id, e) => chamar(`/aparelhos/${id}`, { method: 'PATCH', body: JSON.stringify(e) }),
  }
}
