import { ErroApi } from './clientes'
import type { VendasApi } from './vendas'

type Requisicao = (url: string, init?: RequestInit) => Promise<Response>

export function criarVendasHttp(baseUrl: string, requisicao: Requisicao): VendasApi {
  async function chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
    let r: Response
    try {
      r = await requisicao(`${baseUrl}/api${caminho}`, { ...init, headers: { 'content-type': 'application/json', ...init.headers } })
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
    criar: (_s, e) => chamar('/vendas', { method: 'POST', body: JSON.stringify(e) }),
    listar: (_s, q) => chamar('/vendas' + qs(q)),
    obter: (_s, id) => chamar(`/vendas/${id}`),
    resumo: () => chamar('/vendas/resumo'),
    juros: () => chamar('/config/juros'),
  }
}
