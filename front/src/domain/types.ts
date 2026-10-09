export type Perfil = 'ADMIN' | 'VENDEDOR' | 'COBRADOR' | 'INDICADOR'
export type FormaPagamento = 'Pix' | 'Dinheiro' | 'Cartão'
export type EstadoBem = 'DISPONIVEL' | 'ENCOMENDADO' | 'VENDIDO'
export type StatusOp = 'ATIVA' | 'QUITADA' | 'RETOMADA'
export type ModalidadeEmp = 'PARCELADO' | 'JUROS' | 'DIARIA'
/** De quanto em quanto tempo o cliente paga. A diária cobra todo dia menos domingo. */
export type Periodicidade = 'MENSAL' | 'QUINZENAL' | 'SEMANAL' | 'DIARIA'
export type StatusContrato = 'AGUARDANDO' | 'ENVIADO' | 'ASSINADO'

/** Data ISO `YYYY-MM-DD`. */
export type Iso = string

export interface Pagamento {
  data: Iso
  valor: number
  forma: FormaPagamento
  /** users.id de quem recebeu (recebido_por) */
  por?: number
  /** agrupa as parcelas pagas de uma vez (transacao_id): vira um recibo e um desfazer */
  tx: number
  /** estado da parcela alvo antes do recebimento, para o "desfazer" voltar tudo como estava */
  antes?: { venc: Iso; vencOriginal?: Iso; desconto: number }
}

export interface Parcela {
  n: number
  venc: Iso
  /** vencimento antes de uma remarcação (venda_parcelas.vencimento_original) */
  vencOriginal?: Iso
  valor: number
  /** data em que quitou, ou null enquanto estiver aberta */
  pago: Iso | null
  pagos: Pagamento[]
  desconto: number
}

export interface Bem {
  id: number
  modelo: string
  gb: number
  cor: string
  bateria: number
  cond: 'Novo' | 'Seminovo'
  imei: string
  /** valor_compra */
  custo: number
  extras: number
  /** preço de venda */
  preco: number
  estado: EstadoBem
  desde: Iso
  origem: 'COMPRA' | 'TROCA'
  paraCliente?: number
}

export interface Cliente {
  id: number
  nome: string
  fone: string
  desde: Iso
  /** clientes.responsavel_id: carteira do cobrador/vendedor */
  responsavelId: number
}

export interface Indicador {
  id: number
  nome: string
  /** fração do lucro (0,5 = 50%) usada nas próximas operações */
  pct: number
  /** true quando o % foi definido à mão, então não sobe sozinho com o nível */
  pctManual?: boolean
}

interface OpBase {
  id: number
  clienteId: number
  data: Iso
  parcelas: Parcela[]
  indicadorId: number
  /** % do indicador congelado quando a operação nasceu (fração, 0,5 = 50%) */
  pct: number
  status: StatusOp
}

export interface Venda extends OpBase {
  tipo: 'VENDA'
  bemId: number
  entrada: number
  troca: number
  contrato: StatusContrato
  vendedorId?: number
}

export interface Emprestimo extends OpBase {
  tipo: 'EMP'
  capital: number
  mod: ModalidadeEmp
  /** parcelado e diária: % de juros NO TOTAL (100% = paga o dobro). Só juros: % a cada parcela. */
  taxa: number
  freq: Periodicidade
}

export type Operacao = Venda | Emprestimo

export interface Usuario {
  id: number
  nome: string
  perfil: Exclude<Perfil, 'INDICADOR'>
  fone: string
}

export interface RepasseIndicador {
  indicadorId: number
  data: Iso
  valor: number
  forma: FormaPagamento
}

export interface ConfigJuros {
  /** % por parcela, juros simples (juros_parcela_pct) */
  pct: number
  /** máximo de parcelas (max_parcelas) */
  maxParcelas: number
}
