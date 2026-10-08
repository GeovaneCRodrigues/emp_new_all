import { addDia } from './datas'
import { arred2 } from './format'
import { faltaP } from './calc'
import type { FormaPagamento, Iso, Parcela } from './types'

export type RestoPagamento = 'FICA' | 'DESCONTO'

export interface Recebimento {
  /** parcela escolhida */
  n: number
  data: Iso
  valor: number
  forma: FormaPagamento
  /** o que fazer quando pagou menos que a parcela */
  resto?: RestoPagamento
  /** nova data do restante quando `resto` é FICA */
  novoVenc?: Iso
  por?: number
  tx: number
}

export type EfeitoRecebimento =
  | { tipo: 'QUITA'; n: number }
  | { tipo: 'ABATE'; n: number; valor: number }
  | { tipo: 'FICA'; n: number; resta: number; venc: Iso }
  | { tipo: 'DESCONTO'; n: number; valor: number }
  | { tipo: 'CREDITO'; valor: number }

/** Vencimento sugerido para o restante: mantém a data se ainda não venceu, senão +7 dias. */
export const vencPadraoResto = (p: Parcela, hoje: Iso): Iso => (p.venc > hoje ? p.venc : addDia(hoje, 7))

/** Prévia do que o recebimento vai fazer, sem mexer em nada. */
export function planoRecebimento(parcelas: Parcela[], r: Pick<Recebimento, 'n' | 'valor' | 'resto' | 'novoVenc'>, hoje: Iso): EfeitoRecebimento[] {
  const alvo = parcelas.find((p) => p.n === r.n)
  if (!alvo || r.valor <= 0) return []
  const falta = faltaP(alvo)
  const dif = arred2(falta - r.valor)
  if (Math.abs(dif) < 0.01) return [{ tipo: 'QUITA', n: alvo.n }]
  if (dif > 0) {
    return r.resto === 'DESCONTO'
      ? [{ tipo: 'DESCONTO', n: alvo.n, valor: dif }]
      : [{ tipo: 'FICA', n: alvo.n, resta: dif, venc: r.novoVenc ?? vencPadraoResto(alvo, hoje) }]
  }
  // pagou a mais: quita a atual e o excedente abate as próximas, em ordem
  const efeitos: EfeitoRecebimento[] = [{ tipo: 'QUITA', n: alvo.n }]
  let sobra = -dif
  for (const q of parcelas.filter((x) => x.n > alvo.n && !x.pago)) {
    if (sobra <= 0.009) break
    const parte = Math.min(sobra, faltaP(q))
    efeitos.push(parte >= faltaP(q) - 0.009 ? { tipo: 'QUITA', n: q.n } : { tipo: 'ABATE', n: q.n, valor: arred2(parte) })
    sobra -= parte
  }
  if (sobra > 0.009) efeitos.push({ tipo: 'CREDITO', valor: arred2(sobra) })
  return efeitos
}

/**
 * Aplica o recebimento e devolve as novas parcelas (não altera as originais).
 * Um recebimento que cobre várias parcelas é uma transação só (mesmo `tx`).
 */
export function aplicarRecebimento(parcelas: Parcela[], r: Recebimento, hoje: Iso): Parcela[] {
  const novas = parcelas.map((p) => ({ ...p, pagos: [...p.pagos] }))
  const alvo = novas.find((p) => p.n === r.n)
  if (!alvo) throw new Error(`Parcela ${r.n} não existe`)
  const antes = { venc: alvo.venc, vencOriginal: alvo.vencOriginal, desconto: alvo.desconto }
  let sobra = r.valor
  let primeiro = true
  for (const p of novas.filter((x) => x.n >= r.n && !x.pago)) {
    if (sobra <= 0.009) break
    const parte = Math.min(sobra, faltaP(p))
    p.pagos.push({ data: r.data, valor: arred2(parte), forma: r.forma, por: r.por, tx: r.tx, ...(primeiro ? { antes } : {}) })
    primeiro = false
    sobra -= parte
    if (faltaP(p) <= 0.009) p.pago = r.data
  }
  if (!alvo.pago && faltaP(alvo) > 0.009) {
    if (r.resto === 'DESCONTO') {
      alvo.desconto = arred2(alvo.desconto + faltaP(alvo))
      alvo.pago = r.data
    } else {
      const novo = r.novoVenc ?? vencPadraoResto(alvo, hoje)
      if (novo !== alvo.venc) {
        alvo.vencOriginal ??= alvo.venc
        alvo.venc = novo
      }
    }
  }
  return novas
}

/** Desfaz uma transação inteira: tira os pagamentos dela e devolve vencimento e desconto como estavam. */
export function desfazerTransacao(parcelas: Parcela[], tx: number): Parcela[] {
  return parcelas.map((p) => {
    const feitos = p.pagos.filter((g) => g.tx === tx)
    if (!feitos.length) return p
    const antes = feitos.find((g) => g.antes)?.antes
    const q: Parcela = { ...p, pagos: p.pagos.filter((g) => g.tx !== tx) }
    if (antes) {
      q.venc = antes.venc
      q.vencOriginal = antes.vencOriginal
      q.desconto = antes.desconto
    }
    q.pago = faltaP(q) <= 0.009 ? (q.pagos.at(-1)?.data ?? null) : null
    return q
  })
}
