import { referencia } from '../../modules/recebimentos/services/calculo.js'
import { gerarCronogramaAntigo, gerarParcelasOperacao, horizonteParcelasJuros } from './cronograma.js'
import type { AcordoAntigo, EstadoAntigo, OperacaoAntiga, ParcelaAntiga, RecebimentoAntigo } from './tipos.js'

/** ---- o que entra no sistema novo ---- */
export interface EstadoParcelaNova { vencimento: string; vencimentoOriginal: string | null; desconto: number; quitadaEm: string | null }

export interface ParcelaNova {
  /** os ids que esta parcela tinha no sistema antigo (mais de um quando o saldo parcial foi unido à parcela de origem) */
  legacyParcelas: string[]
  numero: number
  vencimento: string
  vencimentoOriginal: string | null
  valor: number
  desconto: number
  quitadaEm: string | null
  acordoLegacyId: number | null
  /** só da conversão: quanto já foi alocado nesta parcela */
  pago: number
}

export interface ItemPagamentoNovo { numeroParcela: number; valor: number; antes: EstadoParcelaNova }

export interface ResumoReciboNovo {
  tipo: 'PARCELAS'
  referencia: string
  faltaDepois: number
  proxima: { numero: number; valor: number; vencimento: string } | null
  restantes: number
  ficaDevendo: { numero: number; valor: number; vencimento: string } | null
}

export interface PagamentoNovo {
  legacyId: number
  data: string
  valorTotal: number
  /** o indicador que cobrou direto do cliente (o dinheiro não passou pela mão da loja) */
  cobradoPorIndicadorLegacyId: number | null
  itens: ItemPagamentoNovo[]
  resumo: ResumoReciboNovo
  criadoEm: string | null
}

export interface AcordoNovo {
  legacyId: number
  dataAcordo: string
  saldoAntes: number
  valorTotal: number
  nParcelas: number
  primeiraParcela: string
  motivo: string | null
  parcelasAntes: { numero: number; valor: number; vencimento: string }[]
}

export type ModalidadeNova = 'PARCELADO' | 'JUROS' | 'DIARIA'

export interface EmprestimoNovo {
  legacyId: number
  clienteLegacyId: number
  indicadorLegacyId: number | null
  pct: number
  dataEmprestimo: string
  capital: number
  modalidade: ModalidadeNova
  periodicidade: 'MENSAL' | 'QUINZENAL' | 'SEMANAL' | 'DIARIA'
  taxa: number
  modoDivisao: 'CAPITAL_PRIMEIRO' | 'JUROS_MENSAL'
  observacoes: string | null
  statusAntigo: string
  status: 'ATIVA' | 'QUITADA'
  parcelas: ParcelaNova[]
  pagamentos: PagamentoNovo[]
  acordo: AcordoNovo | null
  criadoEm: string | null
}

export type CodigoAvisoOperacao =
  | 'investimento_como_parcelado' | 'divisao_juros_mensal_ignorada' | 'recebimento_realocado' | 'recebimento_dividido' | 'recebimento_excedente'
  | 'diaria_saldo_rateado' | 'quitacao_parcelas_absorvidas' | 'capital_adicional_do_acordo' | 'saldo_parcial_unido' | 'status_antigo_diferente'

export interface ResultadoOperacao { novo: EmprestimoNovo | null; avisos: CodigoAvisoOperacao[]; erro?: string }

const arred = (v: number) => Math.round(v * 100) / 100
const faltaDe = (p: { valor: number; pago: number; desconto: number }) => arred(p.valor - p.pago - p.desconto)
/** Quantas parcelas de juros ficam à frente no sistema novo (o antigo mostra ~24 meses; aqui um ano, e o acordo estende se precisar). */
const HORIZONTE_NOVO: Record<string, number> = { MENSAL: 12, QUINZENAL: 26, SEMANAL: 52 }

/** Taxa do sistema novo: só juros = % do juro a cada parcela; parcelado/diária = % de juro NO TOTAL sobre o capital. */
function calcularTaxa(modalidade: ModalidadeNova, capital: number, valorPorParcela: number, nParcelasOriginais: number): number {
  if (capital <= 0) return 0
  const t = modalidade === 'JUROS' ? (valorPorParcela / capital) * 100 : ((valorPorParcela * nParcelasOriginais) / capital - 1) * 100
  return Math.min(999.9999, Math.max(0, Math.round(t * 10000) / 10000))
}

/**
 * Converte UMA operação do sistema antigo para o modelo novo: o empréstimo, as parcelas (geradas pela regra antiga), os
 * recebimentos (cada um vira um recibo), e o acordo. Nenhum centavo recebido se perde: tudo o que entrou é alocado nas parcelas.
 */
export function transformarOperacao(op: OperacaoAntiga, estado: EstadoAntigo, hoje: string): ResultadoOperacao {
  const avisos = new Set<CodigoAvisoOperacao>()
  if (op.modalidade === 'JUROS' && op.periodicidade === 'DIARIA') return { novo: null, avisos: [], erro: 'só juros com frequência diária não existe no sistema novo' }

  const recebimentos = estado.recebimentos.filter((r) => r.operacaoId === op.id).sort((a, b) => a.dataPagamento.localeCompare(b.dataPagamento) || a.id - b.id)
  const extras = estado.parcelasExtras.filter((e) => e.operacaoId === op.id)
  const quitacao = estado.quitacoes.find((q) => q.operacaoId === op.id) ?? null
  const acordoAntigo = estado.acordos.find((a) => a.operacaoId === op.id) ?? null
  const idsExtras = new Set(extras.map((e) => e.id))
  // ids de parcela da operação: "<operação>-<n>" e os das parcelas extras (acordo e saldo parcial)
  const daOperacao = (id: string) => idsExtras.has(id) || new RegExp(`^${op.id}-\\d+$`).test(id)
  const ajustes = Object.fromEntries(Object.entries(estado.parcelaAjustes).filter(([id]) => daOperacao(id)))
  const vencs = Object.fromEntries(Object.entries(estado.parcelaVencimentos).filter(([id]) => daOperacao(id)))

  const lista = gerarCronogramaAntigo({ operacoes: [op], recebimentos, parcelasExtras: extras, parcelaAjustes: ajustes, quitacoes: quitacao ? [quitacao] : [], parcelaVencimentos: vencs, acordos: acordoAntigo ? [acordoAntigo] : [], hoje })
  if (!lista.length) return { novo: null, avisos: [], erro: 'a operação não tem parcelas' }

  // quanto cada id de parcela recebeu DE VERDADE (a quitação do antigo "paga" parcelas sem dinheiro: isso não conta)
  const recebidoPorId: Record<string, number> = {}
  for (const r of recebimentos) recebidoPorId[r.parcelaId] = arred((recebidoPorId[r.parcelaId] ?? 0) + r.valor)

  const bases = lista.filter((p) => !p.extra)
  const acordoParcelas = lista.filter((p) => p.extra && p.fase === 'ACORDO')
  const saldosParciais = lista.filter((p) => p.extra && p.fase !== 'ACORDO')

  // ---------- quais parcelas existem no sistema novo ----------
  let escolhidas: ParcelaAntiga[] = [...bases]
  const ehJuros = op.modalidade === 'JUROS'
  if (quitacao) {
    // só ficam as que receberam dinheiro e a da quitação (as "pagas" sem dinheiro eram juros absorvidos pela quitação)
    const antes = escolhidas.length
    escolhidas = escolhidas.filter((p) => (recebidoPorId[p.id] ?? 0) > 0.009 || p.id === quitacao.parcelaOrigemId)
    if (escolhidas.length < antes) avisos.add('quitacao_parcelas_absorvidas')
  } else if (ehJuros && !acordoAntigo) {
    // só juros em aberto: o antigo mostra ~24 meses de juros; aqui, o que já passou + um ano à frente, e o capital na última
    const H = horizonteParcelasJuros(op.periodicidade)
    const ultimaPaga = Math.max(0, ...bases.filter((p) => (recebidoPorId[p.id] ?? 0) > 0.009).map((p) => p.numero))
    const ultimaVencida = Math.max(0, ...bases.filter((p) => p.vencimentoIso <= hoje).map((p) => p.numero))
    const n = Math.min(H, Math.max(ultimaPaga, ultimaVencida) + (HORIZONTE_NOVO[op.periodicidade] ?? 12))
    escolhidas = escolhidas.filter((p) => p.numero <= n)
  }
  escolhidas.sort((a, b) => a.numero - b.numero)
  const acordoOrdenado = [...acordoParcelas].sort((a, b) => a.numero - b.numero)

  // ---------- parcelas novas (numeração contínua) ----------
  const parcelas: ParcelaNova[] = []
  const indicePorIdAntigo = new Map<string, number>()
  const novaParcela = (p: ParcelaAntiga, acordoLegacyId: number | null, valor = p.valor): number => {
    const venc = p.vencimentoIso
    parcelas.push({ legacyParcelas: [p.id], numero: parcelas.length + 1, vencimento: venc, vencimentoOriginal: p.vencimentoOriginalIso ?? null, valor: arred(valor), desconto: 0, quitadaEm: null, acordoLegacyId, pago: 0 })
    indicePorIdAntigo.set(p.id, parcelas.length - 1)
    return parcelas.length - 1
  }
  for (const p of escolhidas) {
    // a quitação do só juros: a parcela leva o que foi pago (juro + capital)
    const valor = quitacao && p.id === quitacao.parcelaOrigemId ? (recebidoPorId[p.id] ?? p.valor) : p.valor
    novaParcela(p, null, valor)
  }
  for (const p of acordoOrdenado) novaParcela(p, acordoAntigo?.id ?? null)

  // o saldo de uma baixa parcial vira a própria parcela de origem (que continua aberta, com a data nova)
  const saldoPorOrigem = new Map<string, ParcelaAntiga>()
  for (const s of saldosParciais) {
    const origem = bases.find((b) => s.id.startsWith(`${b.id}-spl-`)) ?? lista.find((b) => s.id.startsWith(`${b.id}-spl-`))
    const idx = origem ? indicePorIdAntigo.get(origem.id) : undefined
    if (origem && idx !== undefined) {
      parcelas[idx].valor = arred(parcelas[idx].valor + s.valor)
      parcelas[idx].legacyParcelas.push(s.id)
      indicePorIdAntigo.set(s.id, idx)
      saldoPorOrigem.set(origem.id, s)
      avisos.add('saldo_parcial_unido')
    }
  }

  // só juros em aberto (sem acordo): a última parcela leva o capital
  if (ehJuros && !acordoAntigo && !quitacao) parcelas[parcelas.length - 1].valor = arred(parcelas[parcelas.length - 1].valor + op.valorOriginal)

  // ---------- recebimentos, em ordem: cada um vira um recibo ----------
  const pagamentos: PagamentoNovo[] = []
  const abertas = () => parcelas.filter((p) => faltaDe(p) > 0.009)
  const estadoDe = (p: ParcelaNova): EstadoParcelaNova => ({ vencimento: p.vencimento, vencimentoOriginal: p.vencimentoOriginal, desconto: p.desconto, quitadaEm: p.quitadaEm })

  for (const r of recebimentos) {
    let restante = r.valor
    const itens: ItemPagamentoNovo[] = []
    const aplicar = (p: ParcelaNova, quanto: number) => {
      const antes = estadoDe(p)
      p.pago = arred(p.pago + quanto)
      if (faltaDe(p) <= 0.009) p.quitadaEm = r.dataPagamento
      itens.push({ numeroParcela: p.numero, valor: arred(quanto), antes })
      restante = arred(restante - quanto)
    }
    const alvo = indicePorIdAntigo.get(r.parcelaId)
    const ehDiaria = r.parcelaId.startsWith('diaria-')
    let foiParaOAlvo = false
    if (alvo !== undefined) {
      const p = parcelas[alvo]
      const quanto = Math.min(r.valor, Math.max(0, faltaDe(p))) // parcela já cheia: tudo segue para as próximas
      if (quanto > 0.009) {
        aplicar(p, quanto); foiParaOAlvo = true
        // baixa parcial: o que sobrou na parcela vai para outra data (a do saldo parcial do antigo)
        const spl = saldoPorOrigem.get(r.parcelaId)
        if (r.tipo === 'parcial' && spl && faltaDe(p) > 0.009) { p.vencimentoOriginal = p.vencimentoOriginal ?? p.vencimento; p.vencimento = spl.vencimentoIso }
      }
    }
    if (!foiParaOAlvo) avisos.add(ehDiaria ? 'diaria_saldo_rateado' : 'recebimento_realocado')
    // o que ainda não coube: segue para as próximas parcelas em aberto, na ordem
    if (restante > 0.009) {
      if (foiParaOAlvo) avisos.add('recebimento_dividido')
      for (const p of abertas()) {
        if (restante <= 0.009) break
        aplicar(p, Math.min(restante, faltaDe(p)))
      }
    }
    // excedente sem nenhuma parcela aberta: a última parcela cresce para guardar o que foi recebido (nada se perde)
    if (restante > 0.009) {
      const ultima = parcelas[parcelas.length - 1]
      ultima.valor = arred(ultima.valor + restante)
      aplicar(ultima, restante)
      avisos.add('recebimento_excedente')
    }
    const em = abertas().sort((a, b) => a.numero - b.numero)
    const primeiro = parcelas.find((p) => p.numero === itens[0].numeroParcela)!
    pagamentos.push({
      legacyId: r.id, data: r.dataPagamento, valorTotal: arred(itens.reduce((x, i) => x + i.valor, 0)), cobradoPorIndicadorLegacyId: r.cobradoPor === 'INDICADOR' ? op.indicadorId : null, itens, criadoEm: r.criadoEm,
      resumo: {
        tipo: 'PARCELAS', referencia: referencia(itens.map((i) => i.numeroParcela), parcelas.length),
        faltaDepois: arred(parcelas.reduce((x, p) => x + Math.max(0, faltaDe(p)), 0)),
        proxima: em[0] ? { numero: em[0].numero, valor: faltaDe(em[0]), vencimento: em[0].vencimento } : null, restantes: em.length,
        ficaDevendo: faltaDe(primeiro) > 0.009 ? { numero: primeiro.numero, valor: faltaDe(primeiro), vencimento: primeiro.vencimento } : null,
      },
    })
  }

  // ---------- empréstimo ----------
  const modalidade: ModalidadeNova = op.periodicidade === 'DIARIA' ? 'DIARIA' : op.modalidade === 'JUROS' ? 'JUROS' : 'PARCELADO'
  if (op.modalidade === 'INVESTIMENTO/SOCIEDADE') avisos.add('investimento_como_parcelado')
  const temIndicador = op.indicadorId !== null
  let modoDivisao: EmprestimoNovo['modoDivisao'] = 'CAPITAL_PRIMEIRO'
  if (temIndicador && op.modoDivisaoParceiro === 'JUROS_MENSAL') {
    if (modalidade === 'JUROS') modoDivisao = 'JUROS_MENSAL'
    else avisos.add('divisao_juros_mensal_ignorada')
  }
  const capitalAdicional = acordoAntigo?.capitalAdicional ?? 0
  if (capitalAdicional > 0) avisos.add('capital_adicional_do_acordo')
  const capital = arred(op.valorOriginal + capitalAdicional)
  const nOriginais = modalidade === 'JUROS' ? 0 : op.modalidade === 'INVESTIMENTO/SOCIEDADE' ? op.qtdeParcelasRecuperacao + op.qtdeParcelasLucro : op.qtdeParcelasLucro
  const taxa = calcularTaxa(modalidade, op.valorOriginal, op.valorRecebimentoMensal, nOriginais)
  const aberto = arred(parcelas.reduce((x, p) => x + Math.max(0, faltaDe(p)), 0))
  const status: EmprestimoNovo['status'] = aberto <= 0.009 ? 'QUITADA' : 'ATIVA'
  if ((op.status === 'QUITADO') !== (status === 'QUITADA')) avisos.add('status_antigo_diferente')

  let acordo: AcordoNovo | null = null
  if (acordoAntigo) {
    const mantidas = new Set(bases.map((b) => b.id))
    const antes = gerarParcelasOperacao(op, hoje).filter((p) => !mantidas.has(p.id))
    const parciaisAbertas = bases.filter((b) => b.valorFalta > 0.009).reduce((x, b) => x + b.valorFalta, 0)
    acordo = {
      legacyId: acordoAntigo.id, dataAcordo: acordoAntigo.dataAcordo, saldoAntes: arred(antes.reduce((x, p) => x + p.valor, 0) + parciaisAbertas), valorTotal: acordoAntigo.valorTotal,
      nParcelas: acordoParcelas.length || acordoAntigo.qtdeParcelas, primeiraParcela: acordoAntigo.dataPrimeiraParcela, motivo: acordoAntigo.obs?.trim() || null,
      parcelasAntes: antes.map((p) => ({ numero: p.numero, valor: p.valor, vencimento: p.vencimentoIso })),
    }
  }

  return {
    novo: {
      legacyId: op.id, clienteLegacyId: op.clienteId, indicadorLegacyId: op.indicadorId, pct: temIndicador ? Math.min(1, Math.max(0, op.percentualParceiro)) : 0,
      dataEmprestimo: op.dataInicio, capital, modalidade, periodicidade: modalidade === 'DIARIA' ? 'DIARIA' : op.periodicidade === 'DIARIA' ? 'MENSAL' : op.periodicidade, taxa, modoDivisao,
      observacoes: op.obs?.trim() || null, statusAntigo: op.status, status, parcelas, pagamentos, acordo, criadoEm: op.criadoEm,
    },
    avisos: [...avisos],
  }
}

export type { AcordoAntigo, RecebimentoAntigo }
