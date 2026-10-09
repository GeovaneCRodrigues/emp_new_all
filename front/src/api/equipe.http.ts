import { ErroApi } from './clientes'
import type { AprovacoesApi } from './aprovacoes'
import type { EquipeApi } from './equipe'
import type { FechamentosApi } from './fechamentos'

type Requisicao = (url: string, init?: RequestInit) => Promise<Response>

/** Um cliente HTTP só para os três recursos da equipe (aprovações, fechamentos e pessoas). */
function criarChamar(baseUrl: string, requisicao: Requisicao) {
  return async function chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
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
}
const qs = (q: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function criarAprovacoesHttp(baseUrl: string, requisicao: Requisicao): AprovacoesApi {
  const chamar = criarChamar(baseUrl, requisicao)
  return {
    pedirDesconto: (_s, e) => chamar('/aprovacoes', { method: 'POST', body: JSON.stringify({ tipo: 'DESCONTO', ...e }) }),
    pedirRetomada: (_s, e) => chamar('/aprovacoes', { method: 'POST', body: JSON.stringify({ tipo: 'RETOMADA', alvo: 'VENDA', ...e }) }),
    listar: (_s, q) => chamar('/aprovacoes' + qs(q)),
    aprovar: (_s, id) => chamar(`/aprovacoes/${id}/aprovar`, { method: 'POST' }),
    recusar: (_s, id, motivo) => chamar(`/aprovacoes/${id}/recusar`, { method: 'POST', body: JSON.stringify({ motivo }) }),
  }
}

export function criarFechamentosHttp(baseUrl: string, requisicao: Requisicao): FechamentosApi {
  const chamar = criarChamar(baseUrl, requisicao)
  return {
    hoje: () => chamar('/caixa/hoje'),
    fechar: () => chamar('/fechamentos', { method: 'POST' }),
    listar: (_s, q) => chamar('/fechamentos' + qs(q)),
    conferir: (_s, id) => chamar(`/fechamentos/${id}/conferir`, { method: 'POST' }),
    reabrir: (_s, id) => chamar(`/fechamentos/${id}/reabrir`, { method: 'POST' }),
  }
}

export function criarEquipeHttp(baseUrl: string, requisicao: Requisicao): EquipeApi {
  const chamar = criarChamar(baseUrl, requisicao)
  return {
    listar: () => chamar('/equipe'),
    convidar: (_s, e) => chamar('/equipe', { method: 'POST', body: JSON.stringify(e) }),
    atualizar: (_s, id, e) => chamar(`/equipe/${id}`, { method: 'PATCH', body: JSON.stringify(e) }),
  }
}
