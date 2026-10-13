/** O que vem do MySQL do sistema antigo para o estoque e as vendas (datas em AAAA-MM-DD, números como número). */
export interface BemAntigo {
  id: number
  categoria: 'IPHONE' | 'CARRO' | 'IMOVEL' | 'OUTRO'
  descricao: string
  estado: 'ENCOMENDADO' | 'DISPONIVEL' | 'VENDIDO'
  origem: 'COMPRA' | 'TROCA'
  identificador: string | null
  valorCompra: number
  custosExtras: number
  precoVendaSugerido: number | null
  dataCompra: string
  clienteEncomendaId: number | null
  /** json livre do antigo: { modelo, condicao, capacidadeGb, cor } */
  dados: Record<string, unknown> | null
  observacoes: string | null
}

export interface VendaAntiga {
  id: number
  bemId: number
  clienteId: number
  indicadorId: number | null
  /** em PONTOS PERCENTUAIS (50 = 50%), diferente das operações de empréstimo */
  percentualParceiro: number
  dataVenda: string
  valorInvestido: number
  entrada: number
  trocaValor: number
  trocaBemId: number | null
  valorTotal: number
  status: string
  observacoes: string | null
  criadoEm: string | null
}

export interface VendaParcelaAntiga { id: number; vendaId: number; numero: number; vencimento: string; valor: number; vencimentoOriginal: string | null }

export interface VendaRecebimentoAntigo {
  id: number
  vendaId: number
  /** null na entrada e na troca */
  parcelaId: number | null
  tipo: 'ENTRADA' | 'TROCA' | 'PARCELA'
  valor: number
  desconto: number
  dataRecebimento: string
  criadoEm: string | null
}

export interface VendaAjusteAntigo { id: number; vendaId: number; tipo: string; criadoEm: string | null }
export interface VendaRepasseAntigo { id: number; vendaId: number; indicadorId: number | null; valor: number; dataRepasse: string; obs: string | null }

export interface EstadoVendasAntigo {
  bens: BemAntigo[]
  vendas: VendaAntiga[]
  parcelas: VendaParcelaAntiga[]
  recebimentos: VendaRecebimentoAntigo[]
  ajustes: VendaAjusteAntigo[]
  repasses: VendaRepasseAntigo[]
}
