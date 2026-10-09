import { useAuth, modoDemo } from '@/composables/useAuth'
import type { ClientesApi } from './clientes'
import type { EmprestimosApi } from './emprestimos'
import { criarEmprestimosFake } from './emprestimos.fake'
import { criarEmprestimosHttp } from './emprestimos.http'
import type { EstoqueApi } from './estoque'
import { criarEstoqueFake } from './estoque.fake'
import type { AprovacoesApi } from './aprovacoes'
import type { EquipeApi } from './equipe'
import { criarAprovacoesFake, criarEquipeFake, criarFechamentosFake } from './equipe.fake'
import { criarAprovacoesHttp, criarEquipeHttp, criarFechamentosHttp } from './equipe.http'
import type { FechamentosApi } from './fechamentos'
import type { RecebimentosApi } from './recebimentos'
import { criarRecebimentosFake } from './recebimentos.fake'
import { criarRecebimentosHttp } from './recebimentos.http'
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
const vendasFake = modoDemo ? criarVendasFake({ estoque: estoqueFake!, indicadores: indicadoresFake!, clientes: clientesFake! }) : null
export const vendasApi: VendasApi = vendasFake ?? criarVendasHttp(URL_API, requisicao)
export const emprestimosApi: EmprestimosApi = modoDemo ? criarEmprestimosFake({ clientes: clientesFake!, indicadores: indicadoresFake! }) : criarEmprestimosHttp(URL_API, requisicao)
export const recebimentosApi: RecebimentosApi = vendasFake ? criarRecebimentosFake(vendasFake) : criarRecebimentosHttp(URL_API, requisicao)

export const aprovacoesApi: AprovacoesApi = vendasFake ? criarAprovacoesFake(vendasFake) : criarAprovacoesHttp(URL_API, requisicao)
export const fechamentosApi: FechamentosApi = vendasFake ? criarFechamentosFake(vendasFake) : criarFechamentosHttp(URL_API, requisicao)
export const equipeApi: EquipeApi = vendasFake ? criarEquipeFake(vendasFake) : criarEquipeHttp(URL_API, requisicao)
