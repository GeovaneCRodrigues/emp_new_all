import type { ModalidadeEmp, Periodicidade } from './types'

export const MOD_LABEL: Record<ModalidadeEmp, string> = { PARCELADO: 'Parcelado', JUROS: 'Só juros', DIARIA: 'Diária' }

/** Frequência do pagamento: nome, texto do juro e atalhos de quantidade de parcelas (do protótipo). */
export const FREQ: Record<Periodicidade, { label: string; por: string; cada: string; qtd: number[] }> = {
  MENSAL: { label: 'Mensal', por: 'por mês', cada: 'todo mês', qtd: [3, 4, 6, 10, 12] },
  QUINZENAL: { label: 'Quinzenal', por: 'por quinzena', cada: 'a cada 15 dias', qtd: [2, 4, 6, 8, 12] },
  SEMANAL: { label: 'Semanal', por: 'por semana', cada: 'toda semana', qtd: [4, 6, 8, 12, 16] },
  DIARIA: { label: 'Diária', por: 'no total', cada: 'todo dia menos domingo', qtd: [20, 24, 30] },
}

/** "Empréstimo parcelado", "Empréstimo só juros semanal", "Empréstimo diária" (a frequência só aparece quando não é mensal). */
export function nomeEmprestimo(mod: ModalidadeEmp, freq: Periodicidade): string {
  const base = { PARCELADO: 'parcelado', JUROS: 'só juros', DIARIA: 'diária' }[mod]
  return `Empréstimo ${base}${mod !== 'DIARIA' && freq !== 'MENSAL' ? ` ${FREQ[freq].label.toLowerCase()}` : ''}`
}

/** "60% no total" (parcelado e diária) ou "12% por mês" (só juros). */
export function taxaTexto(mod: ModalidadeEmp, freq: Periodicidade, taxa: number): string {
  const n = String(Math.round(taxa * 100) / 100).replace('.', ',')
  return `${n}% ${mod === 'JUROS' ? FREQ[freq].por : 'no total'}`
}

/**
 * Os campos da tela de novo empréstimo se ajustam entre si: mexeu no % → muda o total e a parcela; mexeu no
 * total ou na parcela → muda o %. Parcelado/diária: total = capital × (1 + %). Só juros: o "total" é o juro de cada parcela.
 */
export function pctDoTotal(capital: number, total: number): number {
  return capital > 0 ? Math.round((total / capital - 1) * 1e6) / 1e4 : 0
}
export function pctDaParcela(capital: number, parcela: number, n: number): number {
  return pctDoTotal(capital, parcela * n)
}
export function pctDoJuro(capital: number, juro: number): number {
  return capital > 0 ? Math.round((juro / capital) * 1e6) / 1e4 : 0
}

/**
 * Só juros (sem acordo): quanto dos juros ainda NÃO venceu. O cliente pode quitar o capital quando quiser, então o juro futuro
 * não é dívida dele nem patrimônio da loja. A última parcela leva o capital em aberto, e esse capital continua valendo.
 * Cópia de jurosPorVencerSoJuros do backend. Qualquer outra modalidade, ou só juros com acordo, devolve 0.
 */
export function jurosPorVencerSoJuros(e: { modalidade: ModalidadeEmp; capital: number; amortizado: number; parcelas: { numero: number; vencimento: string; valor: number; desconto: number; pago: number; acordo: string | null }[] }, hoje: string): number {
  if (e.modalidade !== 'JUROS' || e.parcelas.some((p) => p.acordo !== null)) return 0
  const falta = (p: { valor: number; desconto: number; pago: number }) => Math.max(0, p.valor - p.desconto - p.pago)
  const ordenadas = [...e.parcelas].sort((a, b) => a.numero - b.numero)
  const ultima = ordenadas[ordenadas.length - 1]
  if (!ultima) return 0
  const futuras = ordenadas.filter((p) => p.vencimento > hoje)
  const capitalNaUltima = ultima.vencimento > hoje ? Math.min(Math.max(0, e.capital - e.amortizado), falta(ultima)) : 0
  return Math.round(Math.max(0, futuras.reduce((x, p) => x + falta(p), 0) - capitalNaUltima) * 100) / 100
}

/**
 * O que o cliente deve de fato, parcela a parcela. No só juros sem acordo, o juro que ainda não venceu não entra: das parcelas
 * futuras sobra só o capital em aberto, na última. Cópia de faltaExigivel do backend.
 */
export function faltaExigivel(e: { modalidade: ModalidadeEmp; capital: number; amortizado: number; parcelas: { numero: number; vencimento: string; valor: number; desconto: number; pago: number; acordo: string | null }[] }, hoje: string): { vencimento: string; falta: number }[] {
  const arred = (v: number) => Math.round(v * 100) / 100
  const falta = (p: { valor: number; desconto: number; pago: number }) => Math.max(0, arred(p.valor - p.desconto - p.pago))
  const soJuros = e.modalidade === 'JUROS' && !e.parcelas.some((p) => p.acordo !== null)
  const ordenadas = [...e.parcelas].sort((a, b) => a.numero - b.numero)
  const ultima = ordenadas[ordenadas.length - 1]
  return ordenadas.map((p) => {
    const f = falta(p)
    if (!soJuros || p.vencimento <= hoje) return { vencimento: p.vencimento, falta: f }
    return { vencimento: p.vencimento, falta: p === ultima ? Math.min(f, Math.max(0, arred(e.capital - e.amortizado))) : 0 }
  }).filter((x) => x.falta > 0)
}
