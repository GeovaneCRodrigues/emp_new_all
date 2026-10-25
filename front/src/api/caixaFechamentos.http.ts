import { ErroApi } from './clientes'
import type { CaixaFechamentosApi } from './caixaFechamentos'

type Requisicao = (url: string, init?: RequestInit) => Promise<Response>

export function criarCaixaFechamentosHttp(baseUrl: string, requisicao: Requisicao): CaixaFechamentosApi {
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
  return {
    listar: () => chamar('/caixa/fechamentos'),
    previa: (_s, dia) => chamar(`/caixa/fechamentos/previa?dia=${encodeURIComponent(dia)}`),
    fechar: (_s, e) => chamar('/caixa/fechamentos', { method: 'POST', body: JSON.stringify(e) }),
    desfazer: (_s, id) => chamar(`/caixa/fechamentos/${id}`, { method: 'DELETE' }),
  }
}
