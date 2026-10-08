import { ErroApi } from './clientes'
import type { RecebimentosApi } from './recebimentos'

type Requisicao = (url: string, init?: RequestInit) => Promise<Response>

export function criarRecebimentosHttp(baseUrl: string, requisicao: Requisicao): RecebimentosApi {
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
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v))
    const s = p.toString()
    return s ? `?${s}` : ''
  }
  return {
    registrar: (_s, vendaId, e) => chamar(`/vendas/${vendaId}/recebimentos`, { method: 'POST', body: JSON.stringify(e) }),
    recibo: (_s, id) => chamar(`/recibos/${id}`),
    pagamentos: (_s, vendaId) => chamar(`/vendas/${vendaId}/pagamentos`),
    desfazer: (_s, id) => chamar(`/recebimentos/${id}/desfazer`, { method: 'POST' }),
    cobrancas: (_s, q) => chamar('/cobrancas' + qs(q)),
  }
}
