import { arred2 } from '../../vendas/services/calculo.js'

export type TipoOperacao = 'VENDA' | 'EMPRESTIMO'

/** O que o repasse precisa saber de uma operação (venda ou empréstimo) em que o indicador entrou. */
export type OperacaoRepasse = {
  tipo: TipoOperacao
  id: number
  /** data da venda ou do empréstimo: define a ordem em que os pagamentos abatem */
  data: string
  clienteNome: string
  descricao: string
  status: 'ATIVA' | 'QUITADA' | 'RETOMADA' | 'CANCELADA'
  /** % do indicador congelado na hora da operação (fração: 0,5 = 50%) */
  pct: number
  /** capital da operação: custo do aparelho (com extras) ou o valor emprestado */
  investido: number
  total: number
  descontos: number
  recebido: number
  /**
   * Só no modo JUROS_MENSAL do só juros: quanto do que entrou foi JURO. Aí o indicador recebe o % dele sobre os juros a cada
   * pagamento, sem esperar o capital voltar. Sem isto (null), vale a regra normal: depois que o capital voltou.
   */
  jurosRecebidos?: number | null
}

export type OperacaoComRepasse = OperacaoRepasse & {
  /** a parte do indicador no lucro previsto, se tudo for pago */
  parte: number
  /** o que já pode ser pago: % do que entrou DEPOIS que o capital voltou */
  liberado: number
  /** quanto dos pagamentos já feitos caiu nesta operação (mais antiga primeiro) */
  pagoNela: number
  /** liberado e ainda não pago */
  aPagar: number
  /** ainda vai liberar conforme o cliente paga */
  vaiLiberar: number
  /** o capital já voltou? (a partir daqui o lucro começa) */
  capitalVoltou: boolean
}

/** A parte do indicador numa operação: a prevista (se tudo for pago) e a já liberada (o que passou do capital). */
export function partesDoIndicador(o: { total: number; descontos: number; recebido: number; investido: number; pct: number; jurosRecebidos?: number | null }) {
  return {
    parte: arred2(Math.max(0, o.total - o.descontos - o.investido) * o.pct),
    liberado: arred2(Math.max(0, o.jurosRecebidos ?? o.recebido - o.investido) * o.pct),
  }
}

export type ResumoRepasse = {
  liberado: number
  pago: number
  /** o que pode ser pago agora (nunca negativo) */
  aPagar: number
  vaiLiberar: number
  /** pago além do liberado (acontece se um recebimento foi desfeito depois do repasse) */
  pagoAMais: number
  operacoes: OperacaoComRepasse[]
}

/**
 * Repasse de UM indicador. Regra do plano: o indicador fica com o % (congelado em cada operação) do lucro,
 * e só depois que o capital voltou. O dinheiro que entra PRIMEIRO devolve o capital; o que passa disso é lucro.
 * O que o dono já pagou ao indicador abate as operações da mais antiga para a mais nova.
 * Cancelada não conta. Retomada e quitada já não liberam mais nada além do que entrou.
 */
export function calcularRepasse(operacoes: OperacaoRepasse[], pago: number): ResumoRepasse {
  const validas = operacoes.filter((o) => o.status !== 'CANCELADA').sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id || a.tipo.localeCompare(b.tipo))
  let restante = arred2(pago)
  const linhas: OperacaoComRepasse[] = validas.map((o) => {
    const { parte, liberado } = partesDoIndicador(o)
    const pagoNela = arred2(Math.min(liberado, restante))
    restante = arred2(restante - pagoNela)
    const aberta = o.status === 'ATIVA'
    return {
      ...o, parte, liberado, pagoNela, aPagar: arred2(liberado - pagoNela),
      vaiLiberar: aberta ? arred2(Math.max(0, parte - liberado)) : 0,
      capitalVoltou: o.recebido >= o.investido,
    }
  })
  const liberado = arred2(linhas.reduce((x, l) => x + l.liberado, 0))
  const pagoTotal = arred2(pago)
  return {
    liberado, pago: pagoTotal,
    aPagar: arred2(Math.max(0, liberado - pagoTotal)),
    vaiLiberar: arred2(linhas.reduce((x, l) => x + l.vaiLiberar, 0)),
    pagoAMais: arred2(Math.max(0, pagoTotal - liberado)),
    operacoes: linhas,
  }
}
