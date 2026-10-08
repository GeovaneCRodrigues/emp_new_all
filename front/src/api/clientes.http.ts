import { ErroApi, type ClientesApi } from './clientes'

type Requisicao = (url: string, init?: RequestInit) => Promise<Response>

/** Fala com `/api/clientes` do backend. `requisicao` coloca o token e renova a sessão se precisar. */
export function criarClientesHttp(baseUrl: string, requisicao: Requisicao): ClientesApi {
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
    listar: (_s, q) => chamar('/clientes' + qs(q)),
    obter: (_s, id) => chamar(`/clientes/${id}`),
    criar: (_s, e) => chamar('/clientes', { method: 'POST', body: JSON.stringify(e) }),
    atualizar: (_s, id, e) => chamar(`/clientes/${id}`, { method: 'PATCH', body: JSON.stringify(e) }),
    responsaveis: () => chamar('/usuarios/responsaveis'),
  }
}
