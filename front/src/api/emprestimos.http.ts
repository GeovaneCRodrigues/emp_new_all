import { ErroApi } from './clientes'
import type { EmprestimosApi } from './emprestimos'

type Requisicao = (url: string, init?: RequestInit) => Promise<Response>

export function criarEmprestimosHttp(baseUrl: string, requisicao: Requisicao): EmprestimosApi {
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
    criar: (_s, e) => chamar('/emprestimos', { method: 'POST', body: JSON.stringify(e) }),
    listar: (_s, q) => chamar('/emprestimos' + qs(q)),
    obter: (_s, id) => chamar(`/emprestimos/${id}`),
    resumo: () => chamar('/emprestimos/resumo'),
  }
}
