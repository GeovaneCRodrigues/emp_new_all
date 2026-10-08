import { arred2 } from './calculo.js'

export type ParcelaConta = { valor: number; desconto: number; pago: number; vencimento: string }
export type EntradaContas = { entrada: number; troca: number; investido: number; pct: number; parcelas: ParcelaConta[]; statusGravado: string }

/**
 * Situação financeira de uma venda. Regra do negócio: o dinheiro que entra PRIMEIRO devolve o capital;
 * só o que passa disso é lucro. Com indicador, o lucro do dono é só a parte dele (1 − %).
 */
export function contas(v: EntradaContas, hoje: string) {
  const totalParcelas = v.parcelas.reduce((s, p) => s + p.valor, 0)
  const total = arred2(v.entrada + v.troca + totalParcelas)
  const recebido = arred2(v.entrada + v.troca + v.parcelas.reduce((s, p) => s + p.pago, 0))
  const descontos = arred2(v.parcelas.reduce((s, p) => s + p.desconto, 0))
  const lucroTotal = arred2(total - v.investido)
  const falta = arred2(total - recebido - descontos)
  const atrasadas = v.parcelas.filter((p) => arred2(p.valor - p.pago - p.desconto) > 0.009 && p.vencimento < hoje)
  const status = v.statusGravado === 'RETOMADA' || v.statusGravado === 'CANCELADA' ? v.statusGravado : falta <= 0.009 ? 'QUITADA' : 'ATIVA'
  return {
    total, recebido, descontos, falta, lucroTotal, atrasadas: atrasadas.length, status,
    capitalDeVolta: arred2(Math.min(v.investido, recebido)),
    lucroRealizado: arred2(Math.max(0, recebido - v.investido) * (1 - v.pct)),
    seuLucro: arred2(lucroTotal > 0 ? lucroTotal * (1 - v.pct) : lucroTotal),
  }
}
