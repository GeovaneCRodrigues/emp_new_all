import type { Sessao } from '@/domain/escopo'
import type { Empresa, Trecho } from '@/domain/contrato'

export type StatusContratoApi = 'AGUARDANDO' | 'ENVIADO' | 'ASSINADO'

export interface ContratoItemApi {
  id: number
  vendaId: number
  /** "2026-0092" */
  numero: string
  status: StatusContratoApi
  /** versão do modelo com que foi gerado (0 = o texto padrão do sistema) */
  modeloVersao: number
  seguro: boolean
  geradoEm: string
  enviadoEm: string | null
  assinadoEm: string | null
  clienteNome: string
  aparelho: string
  dataVenda: string
  vendaStatus: string
}

export interface ContratoDetalheApi {
  contrato: ContratoItemApi
  /** já foi marcado como enviado: o texto não muda mais */
  congelado: boolean
  trechos: Trecho[]
  /** campos que ainda faltam cadastrar (cliente, empresa, taxas) */
  faltam: string[]
  /** o texto final, para copiar */
  texto: string
}

export interface ListaContratosApi { itens: ContratoItemApi[]; resumo: { assinados: number; esperando: number; comSeguro: number } }
export interface VariavelApi { chave: string; rotulo: string; grupo: string }
export interface ModeloApi { versao: number; texto: string; padrao: string; variaveis: VariavelApi[] }
export interface PreviaApi { trechos: Trecho[]; faltam: string[]; texto: string }

export type EmpresaApi = Empresa

export interface ContratosApi {
  /** `status`: ESPERANDO (sem assinatura) ou ASSINADO. */
  listar(s: Sessao, q?: { status?: 'ESPERANDO' | 'ASSINADO' }): Promise<ListaContratosApi>
  obter(s: Sessao, id: number): Promise<ContratoDetalheApi>
  porVenda(s: Sessao, vendaId: number): Promise<ContratoDetalheApi>
  gerar(s: Sessao, vendaId: number): Promise<ContratoDetalheApi>
  marcarEnviado(s: Sessao, id: number): Promise<ContratoDetalheApi>
  marcarAssinado(s: Sessao, id: number): Promise<ContratoDetalheApi>
  definirSeguro(s: Sessao, id: number, seguro: boolean): Promise<ContratoDetalheApi>
  modelo(s: Sessao): Promise<ModeloApi>
  salvarModelo(s: Sessao, texto: string): Promise<ModeloApi>
  previa(s: Sessao, texto: string, vendaId: number): Promise<PreviaApi>
  empresa(s: Sessao): Promise<EmpresaApi>
  salvarEmpresa(s: Sessao, e: Partial<EmpresaApi>): Promise<EmpresaApi>
}
