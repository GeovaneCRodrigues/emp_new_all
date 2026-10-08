import { faltaP } from './calc'
import type { Contas } from './calc'
import { arred2 } from './format'
import type { Iso, Operacao, RepasseIndicador } from './types'

export interface OpComContas {
  o: Operacao
  k: Contas
}

export interface LinhaRepasse {
  o: Operacao
  k: Contas
  pct: number
  /** lucro já liberado (passou do capital) */
  liberado: number
  /** parte do indicador no que já foi liberado */
  parte: number
  pago: number
  aPagar: number
  /** parte do indicador quando a operação terminar */
  parteTotal: number
}

export interface ResumoRepasse {
  linhas: LinhaRepasse[]
  aPagar: number
  /** pago a mais do que o liberado até agora */
  sobra: number
  liberado: number
  jaPago: number
  ultimo?: Iso
  vaiGanhar: number
}

/**
 * Repasse de um indicador. Cada pagamento é do indicador (não da operação) e abate
 * as operações da mais antiga para a mais nova.
 */
export function repassesDoIndicador(ops: OpComContas[], pagamentos: RepasseIndicador[]): ResumoRepasse {
  const ordenadas = ops.slice().sort((a, b) => a.o.data.localeCompare(b.o.data))
  let restante = pagamentos.reduce((s, r) => s + r.valor, 0)
  const linhas = ordenadas.map(({ o, k }) => {
    const liberado = Math.max(0, k.recebido - k.inv)
    const parte = arred2(liberado * o.pct)
    const usado = Math.min(parte, restante)
    restante -= usado
    return {
      o,
      k,
      pct: o.pct,
      liberado,
      parte,
      pago: usado,
      aPagar: arred2(parte - usado),
      parteTotal: Math.max(0, k.lucroTotal) * o.pct,
    }
  })
  return {
    linhas,
    aPagar: linhas.reduce((s, l) => s + l.aPagar, 0),
    sobra: Math.max(0, restante),
    liberado: linhas.reduce((s, l) => s + l.parte, 0),
    jaPago: pagamentos.reduce((s, r) => s + r.valor, 0),
    ultimo: pagamentos.map((r) => r.data).sort().at(-1),
    vaiGanhar: linhas.reduce((s, l) => s + l.parteTotal, 0),
  }
}

/** Quanto do repasse cada mês vai liberar, olhando as parcelas ainda abertas (atrasadas contam no mês de hoje). */
export function previsaoRepasse(ops: OpComContas[], meses: string[], hoje: Iso): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(meses.map((m) => [m, 0]))
  for (const { o, k } of ops) {
    let acum = k.recebido
    for (const p of o.parcelas.filter((x) => !x.pago).sort((a, b) => a.venc.localeCompare(b.venc))) {
      const antes = acum
      acum += faltaP(p)
      const lucro = Math.max(0, acum - Math.max(antes, k.inv))
      const ym = (p.venc < hoje ? hoje : p.venc).slice(0, 7)
      if (lucro > 0 && ym in out) out[ym] += lucro * o.pct
    }
  }
  return out
}

export interface Nivel {
  id: string
  nome: string
  /** mínimo de operações indicadas */
  min: number
  /** fração do lucro */
  pct: number
}

/** Níveis ainda não confirmados pelo Geovane; ficam configuráveis. */
export const NIVEIS_PADRAO: Nivel[] = [
  { id: 'BRONZE', nome: 'Bronze', min: 0, pct: 0.3 },
  { id: 'PRATA', nome: 'Prata', min: 3, pct: 0.4 },
  { id: 'OURO', nome: 'Ouro', min: 5, pct: 0.5 },
  { id: 'DIAMANTE', nome: 'Diamante', min: 10, pct: 0.55 },
]

export function nivelDe(qtdOperacoes: number, niveis: Nivel[] = NIVEIS_PADRAO) {
  const i = niveis.reduce((a, l, k) => (qtdOperacoes >= l.min ? k : a), 0)
  return { n: qtdOperacoes, nivel: niveis[i], prox: niveis[i + 1] ?? null }
}

/** Confere a tabela de níveis: começa em 0, cresce, e quem está acima nunca ganha menos. Devolve a mensagem do erro, ou null. */
export function validarNiveis(niveis: Nivel[]): string | null {
  if (niveis.length === 0) return 'Informe os níveis'
  if (niveis[0].min !== 0) return 'O primeiro nível precisa começar em 0 operações'
  for (const [i, n] of niveis.entries()) {
    if (!Number.isInteger(n.min) || n.min < 0) return `${n.nome}: o mínimo de operações precisa ser um número inteiro`
    if (!(n.pct > 0 && n.pct <= 1)) return `${n.nome}: o % precisa ficar entre 0 e 100`
    if (i > 0 && n.min <= niveis[i - 1].min) return `${n.nome}: precisa começar depois do nível anterior`
    if (i > 0 && n.pct < niveis[i - 1].pct) return `${n.nome}: não pode ganhar menos que o nível anterior`
  }
  return null
}
