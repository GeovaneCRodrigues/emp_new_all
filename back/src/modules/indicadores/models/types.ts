export type Nivel = {
  id: string
  nome: string
  /** a partir de quantas operações indicadas o nível vale */
  minOperacoes: number
  /** fração do lucro (0,5 = 50%) */
  pct: number
}

export type Indicador = {
  id: number
  nome: string
  whatsapp: string | null
  chavePix: string | null
  /** fração do lucro (0,5 = 50%) usada nas PRÓXIMAS operações; as antigas ficam congeladas */
  pct: number
  /** true: o admin fixou o % à mão, então não sobe sozinho com o nível */
  pctManual: boolean
  ativo: boolean
  /** operações (vendas e empréstimos não cancelados) que ele trouxe */
  operacoes: number
  temAcesso: boolean
}

export type DadosIndicador = { nome: string; whatsapp: string | null; chavePix: string | null; pct: number; pctManual: boolean }
