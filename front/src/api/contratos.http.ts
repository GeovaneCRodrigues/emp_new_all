import { ErroApi } from './clientes'
import type { AssinarPublicoApi, ContratosApi } from './contratos'

type Requisicao = (url: string, init?: RequestInit) => Promise<Response>

export function criarContratosHttp(baseUrl: string, requisicao: Requisicao): ContratosApi {
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
  const json = (m: string, body?: unknown): RequestInit => ({ method: m, body: body === undefined ? undefined : JSON.stringify(body) })
  return {
    listar: (_s, q = {}) => chamar('/contratos' + (q.status ? `?status=${q.status}` : '')),
    obter: (_s, id) => chamar(`/contratos/${id}`),
    porVenda: (_s, vendaId) => chamar(`/contratos/venda/${vendaId}`),
    gerar: (_s, vendaId) => chamar(`/contratos/venda/${vendaId}`, json('POST')),
    marcarEnviado: (_s, id) => chamar(`/contratos/${id}/enviado`, json('POST')),
    marcarAssinado: (_s, id) => chamar(`/contratos/${id}/assinado`, json('POST')),
    definirSeguro: (_s, id, seguro) => chamar(`/contratos/${id}`, json('PATCH', { seguro })),
    gerarLink: (_s, id) => chamar(`/contratos/${id}/link`, json('POST')),
    zapsignStatus: () => chamar('/contratos/zapsign/status'),
    enviarZapsign: (_s, id) => chamar(`/contratos/${id}/zapsign`, json('POST')),
    atualizarZapsign: (_s, id) => chamar(`/contratos/${id}/zapsign/atualizar`, json('POST')),
    modelo: () => chamar('/contratos/modelo'),
    salvarModelo: (_s, texto) => chamar('/contratos/modelo', json('PUT', { texto })),
    previa: (_s, texto, vendaId) => chamar('/contratos/modelo/previa', json('POST', { texto, vendaId })),
    empresa: () => chamar('/contratos/empresa'),
    salvarEmpresa: (_s, e) => chamar('/contratos/empresa', json('PUT', e)),
    salvarLogo: (_s, imagem) => chamar('/contratos/empresa/logo', json('PUT', { imagem })),
    removerLogo: () => chamar('/contratos/empresa/logo', json('DELETE')),
    logoSrc: (versao = 0) => `${baseUrl}/api/empresa/logo?v=${versao}`,
  }
}

/** Sem login e sem token de sessão: a página de assinatura do cliente. */
export function criarAssinarHttp(baseUrl: string): AssinarPublicoApi {
  async function chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
    let r: Response
    try {
      r = await fetch(`${baseUrl}/api/assinar/${encodeURIComponent(caminho)}`, { ...init, headers: init.body ? { 'content-type': 'application/json' } : {} })
    } catch {
      throw new ErroApi(0, 'Sem conexão com o servidor. Tente de novo.')
    }
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) throw new ErroApi(r.status, corpo.erro ?? 'Algo deu errado. Tente de novo.', corpo.codigo)
    return corpo as T
  }
  return {
    ver: (token) => chamar(token),
    assinar: (token, e) => chamar(token, { method: 'POST', body: JSON.stringify(e) }),
  }
}
