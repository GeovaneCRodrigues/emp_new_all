import { ErroApi } from './clientes'
import type { AcordosApi } from './acordos'

type Requisicao = (url: string, init?: RequestInit) => Promise<Response>
const CAMINHO = { VENDA: 'vendas', EMPRESTIMO: 'emprestimos' } as const

export function criarAcordosHttp(baseUrl: string, requisicao: Requisicao): AcordosApi {
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
  return {
    fazer: (_s, alvo, id, e) => chamar(`/${CAMINHO[alvo]}/${id}/acordos`, { method: 'POST', body: JSON.stringify(e) }),
    listar: (_s, alvo, id) => chamar(`/${CAMINHO[alvo]}/${id}/acordos`),
  }
}
