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
  /** só dígitos, com DDD */
  clienteFone: string
  aparelho: string
  dataVenda: string
  vendaStatus: string
}

/** A prova de quem assinou pelo link (só existe depois de assinado). */
export interface AssinaturaContratoApi {
  /** data URL PNG da assinatura desenhada */
  imagem: string
  /** só dígitos */
  cpf: string
  textoHash: string
  ip: string | null
  userAgent: string | null
  assinadoEm: string
}

/** O documento do contrato no ZapSign (só existe se foi enviado por lá). `sandbox`: de teste, sem validade jurídica. */
export interface ZapsignDocumentoApi { status: string; sandbox: boolean; signUrl: string | null; arquivoAssinado: string | null }
export interface ZapsignStatusApi { ativo: boolean; sandbox: boolean; webhook: boolean }
export type ViaAssinaturaApi = 'LINK' | 'ZAPSIGN' | 'MANUAL'

export interface ContratoDetalheApi {
  contrato: ContratoItemApi
  /** já foi marcado como enviado: o texto não muda mais */
  congelado: boolean
  trechos: Trecho[]
  /** campos que ainda faltam cadastrar (cliente, empresa, taxas) */
  faltam: string[]
  /** o texto final, para copiar */
  texto: string
  assinatura: AssinaturaContratoApi | null
  assinaturaVia: ViaAssinaturaApi | null
  zapsign: ZapsignDocumentoApi | null
}

/** O link de assinatura: o token só aparece quando é gerado (no servidor fica só o hash). */
export interface LinkGeradoApi { token: string; expiraEm: string; contrato: ContratoDetalheApi }

/** O que a página pública de assinatura mostra. O CPF aparece mascarado no texto. */
export interface ContratoParaAssinarApi { numero: string; clienteNome: string; aparelho: string; empresa: string; texto: string; expiraEm: string }
export interface EntradaAssinatura { cpf: string; aceito: boolean; /** data URL PNG */ assinatura: string }

/** Páginas públicas (o cliente não tem login): quem manda é o token do link. */
export interface AssinarPublicoApi {
  ver(token: string): Promise<ContratoParaAssinarApi>
  assinar(token: string, e: EntradaAssinatura): Promise<{ numero: string; assinadoEm: string }>
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
  /** Gera (ou troca) o link de assinatura; envia o contrato e fecha o texto. */
  gerarLink(s: Sessao, id: number): Promise<LinkGeradoApi>
  /** O ZapSign está ligado no servidor? Em teste ou em produção? */
  zapsignStatus(s: Sessao): Promise<ZapsignStatusApi>
  /** Manda o contrato para o ZapSign (o texto fecha). Se já foi, devolve o que existe. */
  enviarZapsign(s: Sessao, id: number): Promise<ContratoDetalheApi>
  /** Pergunta ao ZapSign como está o documento (e traz o PDF assinado quando houver). */
  atualizarZapsign(s: Sessao, id: number): Promise<ContratoDetalheApi>
  modelo(s: Sessao): Promise<ModeloApi>
  salvarModelo(s: Sessao, texto: string): Promise<ModeloApi>
  previa(s: Sessao, texto: string, vendaId: number): Promise<PreviaApi>
  empresa(s: Sessao): Promise<EmpresaApi>
  salvarEmpresa(s: Sessao, e: Partial<Omit<EmpresaApi, 'temLogo'>>): Promise<EmpresaApi>
  /** `imagem`: data URL PNG, JPEG ou WEBP (até ~300 KB). */
  salvarLogo(s: Sessao, imagem: string): Promise<EmpresaApi>
  removerLogo(s: Sessao): Promise<EmpresaApi>
  /** Endereço da imagem da logo para um <img> (público). `versao` força recarregar depois de trocar. */
  logoSrc(versao?: number): string
}
