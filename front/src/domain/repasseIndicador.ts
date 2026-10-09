import { arred2 } from './format'

export type TipoOperacao = 'VENDA' | 'EMPRESTIMO'

/** O que o repasse precisa saber de uma operação (venda ou empréstimo) em que o indicador entrou. */
export interface OperacaoRepasse {
  tipo: TipoOperacao
  id: number
  /** data da venda ou do empréstimo: define a ordem em que os pagamentos abatem */
  data: string
  clienteNome: string
  descricao: string
  status: 'ATIVA' | 'QUITADA' | 'RETOMADA' | 'CANCELADA'
  /** % do indicador congelado na hora da operação (fração: 0,5 = 50%) */
  pct: number
  /** capital: custo do aparelho (com extras) ou o valor emprestado */
  investido: number
  total: number
  descontos: number
  recebido: number
}

export interface OperacaoComRepasse extends OperacaoRepasse {
  /** a parte do indicador no lucro previsto, se tudo for pago */
  parte: number
  /** o que já pode ser pago: % do que entrou DEPOIS que o capital voltou */
  liberado: number
  /** quanto dos pagamentos já feitos caiu nesta operação (mais antiga primeiro) */
  pagoNela: number
  aPagar: number
  /** ainda vai liberar conforme o cliente paga */
  vaiLiberar: number
  capitalVoltou: boolean
}

export interface ValoresRepasse {
  liberado: number
  pago: number
  /** o que pode ser pago agora (nunca negativo) */
  aPagar: number
  vaiLiberar: number
  /** pago além do liberado (um recebimento foi desfeito depois do repasse) */
  pagoAMais: number
}

export interface ResumoRepasse extends ValoresRepasse { operacoes: OperacaoComRepasse[] }

/**
 * Repasse de UM indicador: o % (congelado em cada operação) do lucro, só depois que o capital voltou. O dinheiro que
 * entra PRIMEIRO devolve o capital. O que já foi pago abate as operações da mais antiga para a mais nova.
 * É o mesmo cálculo do backend (a demonstração usa este; o sistema de verdade usa o do servidor).
 */
export function calcularRepasse(operacoes: OperacaoRepasse[], pago: number): ResumoRepasse {
  const validas = operacoes.filter((o) => o.status !== 'CANCELADA').sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id || a.tipo.localeCompare(b.tipo))
  let restante = arred2(pago)
  const linhas: OperacaoComRepasse[] = validas.map((o) => {
    const parte = arred2(Math.max(0, o.total - o.descontos - o.investido) * o.pct)
    const liberado = arred2(Math.max(0, o.recebido - o.investido) * o.pct)
    const pagoNela = arred2(Math.min(liberado, restante))
    restante = arred2(restante - pagoNela)
    return {
      ...o, parte, liberado, pagoNela, aPagar: arred2(liberado - pagoNela),
      vaiLiberar: o.status === 'ATIVA' ? arred2(Math.max(0, parte - liberado)) : 0,
      capitalVoltou: o.recebido >= o.investido,
    }
  })
  const liberado = arred2(linhas.reduce((x, l) => x + l.liberado, 0))
  const pagoTotal = arred2(pago)
  return {
    liberado, pago: pagoTotal, aPagar: arred2(Math.max(0, liberado - pagoTotal)),
    vaiLiberar: arred2(linhas.reduce((x, l) => x + l.vaiLiberar, 0)), pagoAMais: arred2(Math.max(0, pagoTotal - liberado)), operacoes: linhas,
  }
}
