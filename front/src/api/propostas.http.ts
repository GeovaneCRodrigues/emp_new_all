import { ErroApi } from './clientes'
import type { PropostasApi } from './propostas'

type Requisicao = (url: string, init?: RequestInit) => Promise<Response>

export function criarPropostasHttp(baseUrl: string, requisicao: Requisicao): PropostasApi {
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
  const json = (v: unknown) => JSON.stringify(v ?? {})
  return {
    criar: (_s, e) => chamar('/propostas', { method: 'POST', body: json(e) }),
    listar: (_s, q) => {
      const p = new URLSearchParams()
      for (const [k, v] of Object.entries(q)) if (v !== undefined) p.set(k, String(v))
      return chamar(`/propostas${p.size ? `?${p}` : ''}`)
    },
    obter: (_s, id) => chamar(`/propostas/${id}`),
    aceitar: (_s, id, e) => chamar(`/propostas/${id}/aceitar`, { method: 'POST', body: json(e) }),
    recusar: (_s, id, e) => chamar(`/propostas/${id}/recusar`, { method: 'POST', body: json(e) }),
    cancelar: (_s, id) => chamar(`/propostas/${id}/cancelar`, { method: 'POST' }),
  }
}
