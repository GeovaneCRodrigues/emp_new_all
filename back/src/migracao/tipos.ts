/** Como os dados chegam do sistema antigo (MySQL). Só o que a etapa de clientes e indicadores usa. */
export interface IndicadorAntigo {
  id: number
  nome: string
  telefone: string | null
  email: string | null
  status: 'ATIVO' | 'INATIVO' | string
  /** os % usados nas operações dele, com quantas operações usam cada um (o % mais usado vira o % do indicador) */
  percentuais: { pct: number; qtd: number }[]
}

export interface ClienteAntigo {
  id: number
  nome: string
  cpf_cnpj: string | null
  rg: string | null
  telefone1: string | null
  telefone2: string | null
  email: string | null
  endereco: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  cep: string | null
  indicador_id: number | null
  status: 'ATIVO' | 'INATIVO' | string
  obs: string | null
  created_at: Date | string | null
}

export interface FonteAntiga {
  indicadores(): Promise<IndicadorAntigo[]>
  clientes(): Promise<ClienteAntigo[]>
}

/** Como ficam no sistema novo. */
export interface IndicadorNovo {
  legacyId: number
  nome: string
  whatsapp: string | null
  /** fração (0,5 = 50%) */
  pct: number
  pctManual: true
  ativo: boolean
}

export interface ClienteNovo {
  legacyId: number
  nome: string
  /** só dígitos (CPF de 11 ou CNPJ de 14), ou null */
  cpf: string | null
  rg: string | null
  /** só dígitos com DDD, ou '' quando o cliente não tem telefone */
  fone: string
  email: string | null
  endereco: string | null
  observacoes: string | null
  /** id do indicador no sistema ANTIGO; quem resolve para o novo é o importador */
  indicadorLegacyId: number | null
  desde: Date | null
}

/** O que mereceu atenção na conversão (o relatório conta por código; nunca leva nome, CPF ou telefone). */
export type CodigoAviso =
  | 'sem_telefone' | 'telefone_invalido' | 'telefone_do_segundo_campo'
  | 'sem_documento' | 'documento_tamanho_estranho' | 'cpf_digito_invalido'
  | 'email_invalido' | 'rg_cortado' | 'endereco_cortado' | 'observacao_cortada' | 'nome_cortado'
  | 'cliente_inativo' | 'indicador_inativo' | 'sem_percentual' | 'whatsapp_invalido' | 'indicador_nao_encontrado'

export interface Aviso { legacyId: number; codigo: CodigoAviso }
export interface Convertido<T> { novo: T | null; avisos: CodigoAviso[]; erro?: string }
