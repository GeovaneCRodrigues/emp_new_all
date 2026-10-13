import { arred2 } from './format'

export type EstadoParcela = 'paga' | 'parcial' | 'atrasada' | 'hoje' | 'aberta' | 'encerrada'

type ParcelaAndamento = { numero: number; vencimento: string; valor: number; desconto: number; pago: number; falta: number; quitadaEm: string | null; acordo: 'NOVA' | 'ENCERRADA' | null }

/** Em que pé está cada parcela: paga, paga em parte, atrasada, vence hoje, a vencer ou encerrada por um acordo. */
export function estadoParcela(p: Pick<ParcelaAndamento, 'falta' | 'pago' | 'vencimento' | 'acordo'>, hoje: string): EstadoParcela {
  if (p.acordo === 'ENCERRADA') return 'encerrada'
  if (p.falta <= 0.009) return 'paga'
  if (p.vencimento < hoje) return 'atrasada'
  if (p.pago > 0.009) return 'parcial'
  return p.vencimento === hoje ? 'hoje' : 'aberta'
}

const emAberto = (p: ParcelaAndamento) => p.acordo !== 'ENCERRADA' && p.falta > 0.009

/** A próxima parcela que pede dinheiro: a de vencimento mais antigo entre as que ainda faltam (se estiver vencida, é a atrasada mais antiga). */
export function proximaParcela(ps: ParcelaAndamento[]): ParcelaAndamento | null {
  return [...ps].filter(emAberto).sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.numero - b.numero)[0] ?? null
}

export const diasDeAtraso = (vencimento: string, hoje: string) => Math.max(0, Math.round((Date.parse(hoje + 'T12:00:00Z') - Date.parse(vencimento + 'T12:00:00Z')) / 86_400_000))

/** Os números do alto da folha de andamento. Parcelas encerradas por acordo não contam como parcela da operação. */
export function resumoAndamento(ps: ParcelaAndamento[], hoje: string) {
  const vivas = ps.filter((p) => p.acordo !== 'ENCERRADA')
  return {
    pagas: vivas.filter((p) => p.falta <= 0.009).length,
    total: vivas.length,
    atrasadas: vivas.filter((p) => estadoParcela(p, hoje) === 'atrasada').length,
    valorAtrasado: arred2(vivas.filter((p) => estadoParcela(p, hoje) === 'atrasada').reduce((x, p) => x + p.falta, 0)),
    proxima: proximaParcela(ps),
  }
}
