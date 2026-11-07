import { ErroApi, type ClientesApi, type DocumentoClienteApi } from './clientes'
import { emBase64 } from '@/domain/arquivo'

type Requisicao = (url: string, init?: RequestInit) => Promise<Response>

/** Fala com `/api/clientes` do backend. `requisicao` coloca o token e renova a sessão se precisar. */
export function criarClientesHttp(baseUrl: string, requisicao: Requisicao): ClientesApi {
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
    listar: (_s, q) => chamar('/clientes' + qs(q)),
    obter: (_s, id) => chamar(`/clientes/${id}`),
    criar: (_s, e) => chamar('/clientes', { method: 'POST', body: JSON.stringify(e) }),
    atualizar: (_s, id, e) => chamar(`/clientes/${id}`, { method: 'PATCH', body: JSON.stringify(e) }),
    responsaveis: () => chamar('/usuarios/responsaveis'),
    async documentos(_s, id) { return (await chamar<{ itens: DocumentoClienteApi[] }>(`/clientes/${id}/documentos`)).itens },
    async enviarDocumento(_s, id, tipo, arquivo) {
      const dados = await emBase64(arquivo)
      return chamar(`/clientes/${id}/documentos`, { method: 'POST', body: JSON.stringify({ tipo, nome: arquivo.name, mime: arquivo.type, dados }) })
    },
    async abrirDocumento(_s, id, docId) {
      let r: Response
      try { r = await requisicao(`${baseUrl}/api/clientes/${id}/documentos/${docId}/arquivo`) } catch { throw new ErroApi(0, 'Sem conexão com o servidor. Tente de novo.') }
      if (!r.ok) { const corpo = await r.json().catch(() => ({})); throw new ErroApi(r.status, corpo.erro ?? 'Não consegui abrir o documento.', corpo.codigo) }
      return r.blob()
    },
    async removerDocumento(_s, id, docId) {
      let r: Response
      try { r = await requisicao(`${baseUrl}/api/clientes/${id}/documentos/${docId}`, { method: 'DELETE' }) } catch { throw new ErroApi(0, 'Sem conexão com o servidor. Tente de novo.') }
      if (!r.ok) { const corpo = await r.json().catch(() => ({})); throw new ErroApi(r.status, corpo.erro ?? 'Não consegui remover o documento.', corpo.codigo) }
    },
  }
}
