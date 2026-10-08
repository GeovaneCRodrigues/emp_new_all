import { ErroAuth, type AuthApi, type Credenciais, type UsuarioAuth } from './auth'

export function criarAuthHttp(baseUrl: string): AuthApi {
  async function chamar<T>(caminho: string, init: RequestInit & { token?: string } = {}): Promise<T> {
    const { token, ...resto } = init
    let r: Response
    try {
      r = await fetch(`${baseUrl}/api/auth${caminho}`, {
        ...resto,
        headers: { ...(resto.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      })
    } catch {
      throw new ErroAuth(0, 'Sem conexão com o servidor. Tente de novo.')
    }
    if (r.status === 204) return undefined as T
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) throw new ErroAuth(r.status, corpo.erro ?? 'Algo deu errado. Tente de novo.')
    return corpo as T
  }
  return {
    login: (email, senha) => chamar<Credenciais>('/login', { method: 'POST', body: JSON.stringify({ email, senha }) }),
    renovar: (refreshToken) => chamar<Credenciais>('/renovar', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
    logout: (token) => chamar<void>('/logout', { method: 'POST', token }),
    eu: (token) => chamar<UsuarioAuth>('/eu', { token }),
    trocarSenha: (token, senhaAtual, novaSenha) => chamar<void>('/senha', { method: 'POST', token, body: JSON.stringify({ senhaAtual, novaSenha }) }),
  }
}
