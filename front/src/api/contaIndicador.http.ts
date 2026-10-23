import { ErroApi } from './clientes'
import type { ContasIndicadorApi } from './contaIndicador'

type Requisicao = (url: string, init?: RequestInit) => Promise<Response>

export function criarContaIndicadorHttp(baseUrl: string, requisicao: Requisicao): ContasIndicadorApi {
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
    saldos: async () => (await chamar<{ itens: Awaited<ReturnType<ContasIndicadorApi['saldos']>> }>('/contas-indicadores')).itens,
    ver: (_s, id, q) => chamar(`/indicadores/${id}/conta${q ? `?pagina=${q.pagina ?? 1}&limite=${q.limite ?? 50}` : ''}`),
    lancarEnvio: (_s, id, e) => chamar(`/indicadores/${id}/conta/envios`, { method: 'POST', body: JSON.stringify(e) }),
  }
}
