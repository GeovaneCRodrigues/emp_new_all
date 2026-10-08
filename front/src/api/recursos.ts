import { useAuth, modoDemo } from '@/composables/useAuth'
import type { ClientesApi } from './clientes'
import type { IndicadoresApi } from './indicadores'
import { criarIndicadoresFake } from './indicadores.fake'
import { criarIndicadoresHttp } from './indicadores.http'
import { criarClientesFake } from './clientes.fake'
import { criarClientesHttp } from './clientes.http'

const URL_API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

/** Cada recurso usa o backend de verdade quando `VITE_API_URL` existe, e a versão de demonstração quando não. */
export const clientesApi: ClientesApi = modoDemo ? criarClientesFake() : criarClientesHttp(URL_API, (u, i) => useAuth().requisicao(u, i))

export const indicadoresApi: IndicadoresApi = modoDemo ? criarIndicadoresFake() : criarIndicadoresHttp(URL_API, (u, i) => useAuth().requisicao(u, i))
