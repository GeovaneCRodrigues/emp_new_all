import { ErroApi } from './clientes'
import type { NotificacoesApi } from './notificacoes'

type Requisicao = (url: string, init?: RequestInit) => Promise<Response>

export function criarNotificacoesHttp(baseUrl: string, requisicao: Requisicao): NotificacoesApi {
  async function chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
    let r: Response
    try {
      r = await requisicao(`${baseUrl}/api${caminho}`, init)
    } catch {
      throw new ErroApi(0, 'Sem conexão com o servidor. Tente de novo.')
    }
    if (r.status === 204) return undefined as T
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) throw new ErroApi(r.status, corpo.erro ?? 'Algo deu errado. Tente de novo.', corpo.codigo)
    return corpo as T
  }
  return {
    listar: () => chamar('/notificacoes'),
    marcarLida: (_s, id) => chamar(`/notificacoes/${id}/lida`, { method: 'POST' }),
    marcarTodas: () => chamar('/notificacoes/lidas', { method: 'POST' }),
  }
}
