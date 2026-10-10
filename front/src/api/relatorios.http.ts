import { ErroApi } from './clientes'
import type { RelatoriosApi } from './relatorios'

type Requisicao = (url: string, init?: RequestInit) => Promise<Response>

export function criarRelatoriosHttp(baseUrl: string, requisicao: Requisicao): RelatoriosApi {
  return {
    async ver() {
      let r: Response
      try { r = await requisicao(`${baseUrl}/api/relatorios`) } catch { throw new ErroApi(0, 'Sem conexão com o servidor. Tente de novo.') }
      const corpo = await r.json().catch(() => ({}))
      if (!r.ok) throw new ErroApi(r.status, corpo.erro ?? 'Algo deu errado. Tente de novo.', corpo.codigo)
      return corpo
    },
  }
}
