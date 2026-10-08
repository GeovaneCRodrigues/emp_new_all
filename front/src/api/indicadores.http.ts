import { ErroApi } from './clientes'
import type { IndicadoresApi } from './indicadores'

type Requisicao = (url: string, init?: RequestInit) => Promise<Response>

export function criarIndicadoresHttp(baseUrl: string, requisicao: Requisicao): IndicadoresApi {
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
  const json = (v: unknown) => JSON.stringify(v)
  return {
    listar: () => chamar('/indicadores'),
    opcoes: () => chamar('/indicadores/opcoes'),
    obter: (_s, id) => chamar(`/indicadores/${id}`),
    criar: (_s, e) => chamar('/indicadores', { method: 'POST', body: json(e) }),
    atualizar: (_s, id, e) => chamar(`/indicadores/${id}`, { method: 'PATCH', body: json(e) }),
    criarAcesso: (_s, id, email) => chamar(`/indicadores/${id}/acesso`, { method: 'POST', body: json({ email }) }),
    niveis: () => chamar('/niveis'),
    salvarNiveis: (_s, t) => chamar('/niveis', { method: 'PUT', body: json(t) }),
  }
}
