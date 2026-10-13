export type StatusVenda = 'ATIVA' | 'QUITADA' | 'RETOMADA' | 'CANCELADA'
/** SEM_CONTRATO: venda antiga (migrada do sistema anterior), que não tinha contrato */
export type StatusContrato = 'AGUARDANDO' | 'ENVIADO' | 'ASSINADO' | 'SEM_CONTRATO'
export type FormaPagamento = 'PIX' | 'DINHEIRO' | 'CARTAO'

export type ParcelaVenda = {
  id: number
  numero: number
  vencimento: string
  /** vencimento antes de uma remarcação */
  vencimentoOriginal: string | null
  valor: number
  desconto: number
  quitadaEm: string | null
  /** quanto já entrou nesta parcela (recebimentos não desfeitos) */
  pago: number
  /** NOVA: criada por um acordo. ENCERRADA: um acordo a encerrou (ficou só com o que já foi pago). */
  acordo: 'NOVA' | 'ENCERRADA' | null
}

export type Venda = {
  id: number
  aparelho: { id: number; modelo: string; gb: number; cor: string }
  cliente: { id: number; nome: string }
  vendedorId: number | null
  indicador: { id: number; nome: string } | null
  /** % do indicador congelado na hora da venda (fração) */
  pct: number
  dataVenda: string
  precoAcordado: number
  entrada: number
  troca: number
  jurosPct: number
  /** custo do aparelho no dia da venda (custo + extras) */
  investido: number
  status: StatusVenda
  contrato: StatusContrato
  /** quando e por quê o aparelho foi retomado (só em venda RETOMADA) */
  retomada: { em: string; motivo: string | null } | null
  parcelas: ParcelaVenda[]
}

/** Quais vendas um pedido pode enxergar. */
export type EscopoVendas =
  | { tipo: 'TODOS' }
  | { tipo: 'VENDEDOR'; usuarioId: number } // as que ele fez ou as dos clientes da carteira dele
  | { tipo: 'CARTEIRA'; usuarioId: number } // as dos clientes da carteira (cobrador)
  | { tipo: 'INDICADOR'; indicadorId: number } // só leitura: as que ele indicou

export type AparelhoTravado = {
  id: number
  modelo: string
  gb: number
  cor: string
  estado: 'DISPONIVEL' | 'ENCOMENDADO' | 'VENDIDO'
  custo: number
  extras: number
  preco: number
  clienteEncomendaId: number | null
}

export type NovaVenda = {
  bemId: number
  clienteId: number
  vendedorId: number | null
  indicadorId: number | null
  pct: number
  dataVenda: string
  precoAcordado: number
  entrada: number
  troca: number
  trocaBemId: number | null
  jurosPct: number
  investido: number
  total: number
  status: StatusVenda
}

export type NovaTroca = { modelo: string; gb: number; cor: string; bateria: number; imei: string | null; custo: number; preco: number; dataCompra: string }
