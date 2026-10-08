import { computed, ref } from 'vue'
import { ErroAuth, type AuthApi, type Credenciais, type UsuarioAuth } from '@/api/auth'
import { criarAuthFake } from '@/api/auth.fake'
import { criarAuthHttp } from '@/api/auth.http'
import type { Sessao } from '@/domain/escopo'

const URL_API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')
/** Sem `VITE_API_URL` o app roda em modo demonstração (login falso, dados de exemplo). */
export const modoDemo = !URL_API

const CHAVE_REFRESH = 'mdi:refresh'
const guardar = (v: string | null) => { try { v ? localStorage.setItem(CHAVE_REFRESH, v) : localStorage.removeItem(CHAVE_REFRESH) } catch { /* sem storage: a sessão só dura até recarregar */ } }
const lerRefresh = () => { try { return localStorage.getItem(CHAVE_REFRESH) } catch { return null } }

let api: AuthApi = URL_API ? criarAuthHttp(URL_API) : criarAuthFake()
export function usarAuthApi(a: AuthApi) { api = a }

// o token de acesso fica só na memória; o refresh token é o que sobrevive ao recarregar a página
const usuario = ref<UsuarioAuth | null>(null)
let accessToken: string | null = null
let iniciando: Promise<void> | null = null
let renovando: Promise<boolean> | null = null

function aceitar(c: Credenciais) {
  usuario.value = c.usuario
  accessToken = c.accessToken
  guardar(c.refreshToken)
}
function limpar() {
  usuario.value = null
  accessToken = null
  guardar(null)
}

/** Troca o refresh token por um novo par. Vários pedidos ao mesmo tempo compartilham uma renovação só. */
function renovar(): Promise<boolean> {
  return (renovando ??= (async () => {
    const ref = lerRefresh()
    if (!ref) return false
    try { aceitar(await api.renovar(ref)); return true }
    catch (e) {
      // só desloga se o servidor recusou; se ele está fora do ar, mantém o refresh para tentar depois
      if (e instanceof ErroAuth && e.status !== 0) limpar()
      return false
    }
  })().finally(() => { renovando = null }))
}

export function useAuth() {
  return {
    usuario,
    logado: computed(() => usuario.value !== null),

    /** Restaura a sessão ao abrir o app (uma vez). */
    iniciar(): Promise<void> {
      return (iniciando ??= renovar().then(() => undefined))
    },

    async entrar(email: string, senha: string) {
      aceitar(await api.login(email, senha))
    },

    async sair() {
      const t = accessToken
      limpar() // sai da tela primeiro; se o servidor falhar, o token já foi descartado aqui
      if (t) await api.logout(t).catch(() => undefined)
    },

    /** Sessão do usuário logado, no formato que as telas e o escopo usam. */
    sessao(): Sessao | null {
      const u = usuario.value
      return u ? { perfil: u.perfil, usuarioId: u.perfil === 'INDICADOR' ? undefined : u.id, indicadorId: u.indicadorId ?? undefined } : null
    },

    /** `fetch` com o token. Se der 401, renova a sessão uma vez e tenta de novo. */
    async requisicao(url: string, init: RequestInit = {}): Promise<Response> {
      const enviar = () => fetch(url, { ...init, headers: { ...init.headers, ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) } })
      let r = await enviar()
      if (r.status === 401 && (await renovar())) r = await enviar()
      if (r.status === 401) limpar()
      return r
    },
  }
}
