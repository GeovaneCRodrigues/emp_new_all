import { useAuth, modoDemo } from '@/composables/useAuth'
import type { ClientesApi } from './clientes'
import type { EmprestimosApi } from './emprestimos'
import { criarEmprestimosFake } from './emprestimos.fake'
import { criarEmprestimosHttp } from './emprestimos.http'
import type { EstoqueApi } from './estoque'
import { criarEstoqueFake } from './estoque.fake'
import type { CaixaApi } from './caixa'
import type { ContratosApi } from './contratos'
import { criarContratosFake } from './contratos.fake'
import { criarContratosHttp } from './contratos.http'
import type { RelatoriosApi } from './relatorios'
import { criarRelatoriosFake } from './relatorios.fake'
import { criarRelatoriosHttp } from './relatorios.http'
import { criarCaixaFake } from './caixa.fake'
import { criarCaixaHttp } from './caixa.http'
import type { AcordosApi } from './acordos'
import { criarAcordosFake } from './acordos.fake'
import { criarAcordosHttp } from './acordos.http'
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
import type { PropostasApi } from './propostas'
import { criarPropostasFake } from './propostas.fake'
import { criarPropostasHttp } from './propostas.http'
import type { RepassesApi } from './repasses'
import { criarRepassesFake } from './repasses.fake'
import { criarRepassesHttp } from './repasses.http'
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
const emprestimosFake = modoDemo ? criarEmprestimosFake({ clientes: clientesFake!, indicadores: indicadoresFake! }) : null
export const emprestimosApi: EmprestimosApi = emprestimosFake ?? criarEmprestimosHttp(URL_API, requisicao)
const recebimentosFake = vendasFake ? criarRecebimentosFake(vendasFake, emprestimosFake!) : null
export const recebimentosApi: RecebimentosApi = recebimentosFake ?? criarRecebimentosHttp(URL_API, requisicao)

const acordosFake = vendasFake ? criarAcordosFake(vendasFake, emprestimosFake!) : null
export const acordosApi: AcordosApi = acordosFake ?? criarAcordosHttp(URL_API, requisicao)
export const aprovacoesApi: AprovacoesApi = vendasFake ? criarAprovacoesFake(vendasFake, emprestimosFake!, acordosFake!, recebimentosFake!) : criarAprovacoesHttp(URL_API, requisicao)
export const fechamentosApi: FechamentosApi = vendasFake ? criarFechamentosFake(vendasFake) : criarFechamentosHttp(URL_API, requisicao)
export const repassesApi: RepassesApi = vendasFake ? criarRepassesFake({ vendas: vendasApi, emprestimos: emprestimosApi, indicadores: indicadoresApi, hoje: vendasFake._interno.hoje }) : criarRepassesHttp(URL_API, requisicao)
export const propostasApi: PropostasApi = vendasFake ? criarPropostasFake({ clientes: clientesApi, estoque: estoqueApi, vendas: vendasApi, emprestimos: emprestimosApi, indicadores: indicadoresApi, hoje: vendasFake._interno.hoje }) : criarPropostasHttp(URL_API, requisicao)
export const equipeApi: EquipeApi = vendasFake ? criarEquipeFake(vendasFake) : criarEquipeHttp(URL_API, requisicao)
export const caixaApi: CaixaApi = vendasFake ? criarCaixaFake({ vendas: vendasFake, emprestimos: emprestimosFake!, estoque: estoqueApi, repasses: repassesApi }) : criarCaixaHttp(URL_API, requisicao)
export const relatoriosApi: RelatoriosApi = vendasFake ? criarRelatoriosFake({ vendas: vendasFake, emprestimos: emprestimosFake!, estoque: estoqueApi, caixa: caixaApi, repasses: repassesApi }) : criarRelatoriosHttp(URL_API, requisicao)
export const contratosApi: ContratosApi = vendasFake ? criarContratosFake({ vendas: vendasFake, clientes: clientesApi, estoque: estoqueApi }) : criarContratosHttp(URL_API, requisicao)
