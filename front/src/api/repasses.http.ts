import { ErroApi } from './clientes'
import type { RepassesApi } from './repasses'

type Requisicao = (url: string, init?: RequestInit) => Promise<Response>

export function criarRepassesHttp(baseUrl: string, requisicao: Requisicao): RepassesApi {
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
    resumo: () => chamar('/repasses'),
    detalhe: (_s, id) => chamar(`/indicadores/${id}/repasse`),
    pagar: (_s, id, e) => chamar(`/indicadores/${id}/repasses`, { method: 'POST', body: JSON.stringify(e) }),
    jaPagos: (_s, id) => chamar(`/repasses/pagos${id ? `?indicadorId=${id}` : ''}`),
  }
}
