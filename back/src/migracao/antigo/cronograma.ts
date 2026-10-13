import type { AcordoAntigo, AjustesAntigos, OperacaoAntiga, ParcelaAntiga, ParcelaExtraAntiga, PeriodicidadeAntiga, QuitacaoAntiga, RecebimentoAntigo, VencimentosAntigos } from './tipos.js'

/**
 * Porte, para TypeScript, da regra de cronograma do sistema antigo (backend/src/utils/cronogramaService.js e periodicidade.js).
 * No antigo as parcelas de empréstimo NÃO são tabela: são geradas aqui, na hora, a partir da operação, e depois recebem os
 * ajustes, as datas remarcadas, os pagamentos, os acordos e a quitação. Para trazer os dados, geramos a mesma lista.
 * O que importa é dar o MESMO resultado do original (tem teste de paridade contra o código antigo rodando de verdade).
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v))
const arred = (v: number) => Math.round(v * 100) / 100
const pad = (n: number) => String(n).padStart(2, '0')

/** Soma dias a uma data AAAA-MM-DD (aritmética de calendário). */
export function somarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + dias))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

const DIAS: Record<PeriodicidadeAntiga, number> = { DIARIA: 1, SEMANAL: 7, QUINZENAL: 14, MENSAL: 30 }
const HORIZONTE: Record<PeriodicidadeAntiga, number> = { DIARIA: 730, SEMANAL: 104, QUINZENAL: 52, MENSAL: 24 }
export const normalizarPeriodicidade = (v: string | null | undefined): PeriodicidadeAntiga => (v === 'DIARIA' || v === 'SEMANAL' || v === 'QUINZENAL' || v === 'MENSAL' ? v : 'MENSAL')
export const diasPeriodicidade = (p: string) => DIAS[normalizarPeriodicidade(p)]
/** Quantas parcelas de juros o antigo mostra à frente (~24 meses). */
export const horizonteParcelasJuros = (p: string) => HORIZONTE[normalizarPeriodicidade(p)]

/** Vencimento da parcela de índice `i` (0 = a primeira). Mensal: no `dia`, a partir do mês do início, sem passar do fim do mês. */
export function vencimentoDaParcela(dataInicio: string, diaVencimento: number, i: number, periodicidade: string): string {
  const p = normalizarPeriodicidade(periodicidade)
  if (p === 'DIARIA') return somarDias(dataInicio, i)
  if (p === 'SEMANAL') return somarDias(dataInicio, i * 7)
  if (p === 'QUINZENAL') return somarDias(dataInicio, i * 14)
  const [y, m] = dataInicio.split('-').map(Number)
  const primeiro = new Date(Date.UTC(y, m - 1 + i, 1))
  const ano = primeiro.getUTCFullYear(), mes = primeiro.getUTCMonth()
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate()
  return `${ano}-${pad(mes + 1)}-${pad(Math.min(Number(diaVencimento), ultimo))}`
}

const totalParcelasOperacao = (op: OperacaoAntiga) => {
  if (op.modalidade === 'PARCELADO') return op.qtdeParcelasLucro || 0
  if (op.modalidade === 'INVESTIMENTO/SOCIEDADE') return (op.qtdeParcelasRecuperacao || 0) + (op.qtdeParcelasLucro || 0)
  if (op.modalidade === 'JUROS') return horizonteParcelasJuros(op.periodicidade)
  return 0
}

type Base = Omit<ParcelaAntiga, 'status' | 'valorPago' | 'valorFalta'> & { status: ParcelaAntiga['status'] }

function criarParcela(op: OperacaoAntiga, numero: number, indice: number, fase: string, valor: number, hoje: string): Base {
  const venc = vencimentoDaParcela(op.dataInicio, op.diaVencimento, indice, op.periodicidade || 'MENSAL')
  return {
    id: `${op.id}-${numero}`, operacaoId: op.id, numero, totalParcelas: totalParcelasOperacao(op), vencimentoIso: venc, valor, fase,
    status: venc < hoje ? 'VENCIDO' : 'A_VENCER', extra: false,
  }
}

/** As parcelas "de fábrica" da operação, antes de qualquer pagamento, ajuste ou acordo. */
export function gerarParcelasOperacao(op: OperacaoAntiga, hoje: string): Base[] {
  if (!op.dataInicio || !op.diaVencimento || !op.valorRecebimentoMensal) return []
  const valor = op.valorRecebimentoMensal
  const out: Base[] = []
  if (op.modalidade === 'PARCELADO') {
    for (let i = 0; i < (op.qtdeParcelasLucro || 0); i++) out.push(criarParcela(op, i + 1, i, 'PARCELA', valor, hoje))
  } else if (op.modalidade === 'INVESTIMENTO/SOCIEDADE') {
    const r = op.qtdeParcelasRecuperacao || 0
    for (let i = 0; i < r; i++) out.push(criarParcela(op, i + 1, i, 'RECUPERAÇÃO CAPITAL', valor, hoje))
    for (let i = 0; i < (op.qtdeParcelasLucro || 0); i++) out.push(criarParcela(op, r + i + 1, r + i, 'LUCRO/SOCIEDADE', valor, hoje))
  } else if (op.modalidade === 'JUROS') {
    for (let i = 0; i < horizonteParcelasJuros(op.periodicidade); i++) out.push(criarParcela(op, i + 1, i, 'JUROS', valor, hoje))
  }
  return out
}

function resolverStatus(venc: string, valor: number, pago: number, hoje: string): Pick<ParcelaAntiga, 'status' | 'valorPago' | 'valorFalta'> {
  const falta = Math.max(0, arred(valor - pago))
  if (falta <= 0.009) return { status: 'PAGO', valorPago: pago, valorFalta: 0 }
  if (pago > 0) return { status: 'PARCIAL', valorPago: pago, valorFalta: falta }
  return { status: venc < hoje ? 'VENCIDO' : 'A_VENCER', valorPago: 0, valorFalta: valor }
}

/**
 * O estado das parcelas de TODAS as operações, como o sistema antigo calcula (`gerarCronograma`).
 * `hoje` só decide VENCIDO x A_VENCER das que não têm pagamento.
 */
export function gerarCronogramaAntigo(a: {
  operacoes: OperacaoAntiga[]
  recebimentos: RecebimentoAntigo[]
  parcelasExtras: ParcelaExtraAntiga[]
  parcelaAjustes: AjustesAntigos
  quitacoes: QuitacaoAntiga[]
  parcelaVencimentos: VencimentosAntigos
  acordos: Pick<AcordoAntigo, 'operacaoId'>[]
  hoje: string
}): ParcelaAntiga[] {
  const { hoje } = a
  const base: (Base & { valorOriginalParcela?: number })[] = a.operacoes.flatMap((op) => gerarParcelasOperacao(op, hoje)).map((p) => {
    const aj = a.parcelaAjustes[p.id]
    return aj ? { ...p, valor: aj.valorAjustado, valorOriginalParcela: p.valor } : p
  })
  const extras: (Base & { valorOriginalParcela?: number })[] = a.parcelasExtras.map((e) => {
    const b: Base = {
      id: e.id, operacaoId: e.operacaoId, numero: e.parcelaNumero, totalParcelas: e.totalParcelas, vencimentoIso: e.vencimentoIso, valor: e.valor, fase: e.fase,
      status: e.vencimentoIso < hoje ? 'VENCIDO' : 'A_VENCER', extra: true,
    }
    const aj = a.parcelaAjustes[e.id]
    return aj ? { ...b, valor: aj.valorAjustado, valorOriginalParcela: e.valor } : b
  })

  // datas remarcadas
  const comVenc = [...base, ...extras].map((p) => {
    const o = a.parcelaVencimentos[p.id]
    return o ? { ...p, vencimentoIso: o.vencimentoIso, vencimentoOriginalIso: p.vencimentoOriginalIso ?? p.vencimentoIso } : p
  })

  // pagamentos por parcela
  const pagos: Record<string, number> = {}
  for (const r of a.recebimentos) pagos[r.parcelaId] = (pagos[r.parcelaId] || 0) + num(r.valor)
  const comPag: ParcelaAntiga[] = comVenc.map((p) => ({ ...p, ...resolverStatus(p.vencimentoIso, p.valor, pagos[p.id] || 0, hoje) }))

  // acordo: o que ainda não foi pago do combinado antigo sai; ficam as parcelas do acordo e as que já tiveram pagamento
  const comAcordo = new Set(a.acordos.map((x) => x.operacaoId))
  const aposAcordo = comPag.filter((p) => !comAcordo.has(p.operacaoId) || p.fase === 'ACORDO' || p.status === 'PAGO' || p.valorPago > 0.009)

  // quitação: encerra a operação (parcelas futuras sem pagamento somem; as outras ficam pagas)
  const quitacao = new Map(a.quitacoes.map((q) => [q.operacaoId, q]))
  const final: ParcelaAntiga[] = []
  for (const p of aposAcordo) {
    const q = quitacao.get(p.operacaoId)
    if (!q) { final.push(p); continue }
    const teveReal = p.valorPago > 0.009
    const origem = p.id === q.parcelaOrigemId
    if (!teveReal && p.vencimentoIso > q.dataPagamento) continue
    if (teveReal) { final.push({ ...p, status: 'PAGO', valorFalta: 0, quitacaoOperacao: origem }); continue }
    final.push({ ...p, status: 'PAGO', valorPago: p.valor, valorFalta: 0, quitacaoOperacao: true })
  }
  return final
}
