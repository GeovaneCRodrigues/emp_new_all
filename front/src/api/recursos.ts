import { useAuth, modoDemo } from '@/composables/useAuth'
import type { ClientesApi } from './clientes'
import type { EstoqueApi } from './estoque'
import { criarEstoqueFake } from './estoque.fake'
import type { VendasApi } from './vendas'
import { criarVendasFake } from './vendas.fake'
import { criarVendasHttp } from './vendas.http'
import { criarEstoqueHttp } from './estoque.http'
import type { IndicadoresApi } from './indicadores'
import { criarIndicadoresFake } from './indicadores.fake'
import { criarIndicadoresHttp } from './indicadores.http'
import { criarClientesFake } from './clientes.fake'
import { criarClientesHttp } from './clientes.http'

const URL_API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

/**
 * Cada recurso usa o backend de verdade quando `VITE_API_URL` existe, e a versão de demonstração quando não.
 * Na demonstração os recursos se conversam (vender marca o aparelho como vendido, o indicador ganha operação).
 */
const requisicao = (u: string, i?: RequestInit) => useAuth().requisicao(u, i)
const clientesFake = modoDemo ? criarClientesFake() : null
const estoqueFake = modoDemo ? criarEstoqueFake() : null
const indicadoresFake = modoDemo ? criarIndicadoresFake() : null

export const clientesApi: ClientesApi = clientesFake ?? criarClientesHttp(URL_API, requisicao)
export const estoqueApi: EstoqueApi = estoqueFake ?? criarEstoqueHttp(URL_API, requisicao)
export const indicadoresApi: IndicadoresApi = indicadoresFake ?? criarIndicadoresHttp(URL_API, requisicao)
export const vendasApi: VendasApi = modoDemo ? criarVendasFake({ estoque: estoqueFake!, indicadores: indicadoresFake!, clientes: clientesFake! }) : criarVendasHttp(URL_API, requisicao)
