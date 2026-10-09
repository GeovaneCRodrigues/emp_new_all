import { addDia, somaMes } from './datas'
import { arred2 } from './format'
import type { Iso } from './types'

export const ACORDO_MAX_PARCELAS = 120

/** Divide o total em n parcelas: as primeiras com o valor arredondado para baixo e a última com o resto (a soma fecha no centavo). */
export function distribuirAcordo(total: number, n: number): number[] {
  if (!(n >= 1) || !(total > 0)) return []
  const base = Math.floor((total / n) * 100) / 100
  const valores = Array.from({ length: n - 1 }, () => base)
  valores.push(arred2(total - base * (n - 1)))
  return valores
}

/** Mensal, no dia da 1ª parcela (limitado ao fim do mês). */
export const vencimentosAcordo = (primeira: Iso, n: number): Iso[] => Array.from({ length: n }, (_, i) => somaMes(primeira, i, Number(primeira.slice(8, 10))))

/** Valida a proposta do acordo (a mesma regra do backend). Devolve a mensagem do problema, ou '' se está tudo certo. */
export function problemaDoAcordo(a: { valorTotal: number; parcelas: number; primeiraParcela: Iso }, hoje: Iso): string {
  if (!(a.valorTotal > 0) || a.valorTotal > 1e8) return 'Informe o valor do acordo.'
  if (!Number.isInteger(a.parcelas) || a.parcelas < 1 || a.parcelas > ACORDO_MAX_PARCELAS) return `Parcelas: de 1 a ${ACORDO_MAX_PARCELAS}.`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.primeiraParcela)) return 'Informe a data da 1ª parcela.'
  if (a.primeiraParcela < hoje) return 'A 1ª parcela não pode ser numa data que já passou.'
  if (a.primeiraParcela > addDia(hoje, 366)) return 'A 1ª parcela não pode passar de um ano.'
  if (arred2(a.valorTotal) / a.parcelas < 0.01) return 'O valor é pequeno demais para essa quantidade de parcelas.'
  return ''
}
