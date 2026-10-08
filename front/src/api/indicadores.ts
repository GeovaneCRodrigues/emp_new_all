import type { Sessao } from '@/domain/escopo'

export interface NivelApi { id: string; nome: string; minOperacoes: number; pct: number }

export interface IndicadorApi {
  id: number
  nome: string
  /** só dígitos, com DDD */
  whatsapp: string | null
  chavePix: string | null
  /** fração do lucro (0,5 = 50%) nas próximas operações */
  pct: number
  /** true: o admin fixou o % à mão, então não sobe sozinho com o nível */
  pctManual: boolean
  ativo: boolean
  operacoes: number
  temAcesso: boolean
  nivel: NivelApi
  proximoNivel: NivelApi | null
  faltamParaProximo: number | null
}

export interface EntradaIndicador {
  nome?: string
  whatsapp?: string | null
  chavePix?: string | null
  /** % fixado à mão (fração). Não combina com `automatico`. */
  pct?: number
  /** o % acompanha o nível */
  automatico?: boolean
  ativo?: boolean
}

export interface TabelaNiveis { niveis: NivelApi[]; auto: boolean }
export interface AcessoCriado { email: string; senhaTemporaria: string }

export interface IndicadoresApi {
  listar(s: Sessao): Promise<IndicadorApi[]>
  obter(s: Sessao, id: number): Promise<IndicadorApi>
  criar(s: Sessao, e: EntradaIndicador & { nome: string }): Promise<IndicadorApi>
  atualizar(s: Sessao, id: number, e: EntradaIndicador): Promise<IndicadorApi>
  criarAcesso(s: Sessao, id: number, email: string): Promise<AcessoCriado>
  niveis(s: Sessao): Promise<TabelaNiveis>
  salvarNiveis(s: Sessao, t: TabelaNiveis): Promise<TabelaNiveis>
}
