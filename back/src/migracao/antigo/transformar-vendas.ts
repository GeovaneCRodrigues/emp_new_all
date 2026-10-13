import { referencia } from '../../modules/recebimentos/services/calculo.js'
import { maiusculas } from '../../shared/texto.js'
import type { BemAntigo, EstadoVendasAntigo, VendaAntiga } from './tipos-vendas.js'

const arred = (v: number) => Math.round(v * 100) / 100
const falta = (p: { valor: number; pago: number; desconto: number }) => arred(p.valor - p.pago - p.desconto)

/** ---------------- estoque ---------------- */
export type CodigoAvisoBem = 'capacidade_nao_informada' | 'cor_nao_informada' | 'bateria_nao_informada' | 'preco_a_definir' | 'categoria_fora_de_iphone' | 'identificador_nao_e_imei'

export interface BemNovo {
  legacyId: number
  modelo: string
  gb: number
  cor: string
  bateria: number
  condicao: 'Novo' | 'Seminovo'
  imei: string | null
  valorCompra: number
  custosExtras: number
  precoVenda: number
  estado: 'ENCOMENDADO' | 'DISPONIVEL' | 'VENDIDO'
  origem: 'COMPRA' | 'TROCA'
  dataCompra: string
  clienteEncomendaLegacyId: number | null
  observacoes: string | null
}

/** Acha a capacidade escrita na descrição ("128GB", "1 TB", "256"): o valor em GB e o trecho que a escreve. */
function capacidadeNoTexto(descricao: string): { gb: number; trecho: string } | null {
  const tb = /(\d+)\s*TB/i.exec(descricao)
  if (tb) return { gb: Number(tb[1]) * 1024, trecho: tb[0] }
  const gb = /(\d{2,4})\s*GB/i.exec(descricao)
  if (gb) return { gb: Number(gb[1]), trecho: gb[0] }
  const solto = /\b(64|128|256|512)\b/.exec(descricao)
  return solto ? { gb: Number(solto[1]), trecho: solto[0] } : null
}

/** Capacidade em GB: do campo do antigo, ou lida da descrição ("128GB", "256", "1 TB"); 0 = não dá para saber. */
export function lerCapacidade(descricao: string, dados: Record<string, unknown> | null): number {
  const d = Number(dados?.capacidadeGb)
  if (Number.isFinite(d) && d > 0) return Math.round(d)
  return capacidadeNoTexto(descricao)?.gb ?? 0
}

/** O modelo sem a capacidade repetida (ela passa a ter campo próprio): "IPHONE 15 PRO MAX 128GB" → "IPHONE 15 PRO MAX". */
export function modeloSemCapacidade(descricao: string, gb: number): string {
  const achou = capacidadeNoTexto(descricao)
  if (!achou || achou.gb !== gb) return maiusculas(descricao)
  const limpo = descricao.replace(achou.trecho, ' ').replace(/\(\s*\)/g, ' ').replace(/\s+-\s*$/, '').replace(/\s+/g, ' ')
  return maiusculas(limpo) || maiusculas(descricao)
}

export function transformarBem(b: BemAntigo): { novo: BemNovo; avisos: CodigoAvisoBem[] } {
  const avisos: CodigoAvisoBem[] = []
  const notas: string[] = []
  const gb = lerCapacidade(b.descricao, b.dados)
  if (gb === 0) avisos.push('capacidade_nao_informada')
  const corAntiga = typeof b.dados?.cor === 'string' ? maiusculas(b.dados.cor) : ''
  if (!corAntiga) avisos.push('cor_nao_informada')
  avisos.push('bateria_nao_informada')
  if (b.categoria !== 'IPHONE') { avisos.push('categoria_fora_de_iphone'); notas.push(`Categoria no sistema antigo: ${b.categoria}.`) }
  const digitos = (b.identificador ?? '').replace(/\D/g, '')
  const imei = digitos.length === 15 ? digitos : null
  if (b.identificador && !imei) { avisos.push('identificador_nao_e_imei'); notas.push(`Identificador no sistema antigo: ${b.identificador}.`) }
  const faltam = [gb === 0 ? 'capacidade' : '', !corAntiga ? 'cor' : '', 'bateria'].filter(Boolean)
  notas.push(`Do sistema antigo não vieram: ${faltam.join(', ')}. Completar no estoque.`)
  let preco = b.precoVendaSugerido
  if (preco === null || preco <= 0) { avisos.push('preco_a_definir'); preco = arred(b.valorCompra + b.custosExtras); notas.push('Preço de venda não definido no sistema antigo: provisório = custo. Definir.') }
  if (b.observacoes?.trim()) notas.unshift(b.observacoes.trim())
  return {
    avisos,
    novo: {
      legacyId: b.id, modelo: modeloSemCapacidade(b.descricao, gb), gb, cor: corAntiga || 'A DEFINIR', bateria: 0,
      condicao: String(b.dados?.condicao ?? '').toUpperCase() === 'NOVO' ? 'Novo' : 'Seminovo', imei,
      valorCompra: b.valorCompra, custosExtras: b.custosExtras, precoVenda: preco, estado: b.estado, origem: b.origem, dataCompra: b.dataCompra,
      // a reserva para o cliente só vale enquanto o aparelho não foi vendido (o sistema novo zera ao vender)
      clienteEncomendaLegacyId: b.estado === 'ENCOMENDADO' ? b.clienteEncomendaId : null,
      observacoes: notas.join('\n'),
    },
  }
}

/** ---------------- vendas ---------------- */
export interface EstadoParcelaVenda { vencimento: string; vencimentoOriginal: string | null; desconto: number; quitadaEm: string | null }
export interface ParcelaVendaNova { legacyId: number; numero: number; vencimento: string; vencimentoOriginal: string | null; valor: number; desconto: number; quitadaEm: string | null; pago: number }
export interface ResumoReciboVenda { tipo: 'PARCELAS' | 'ENTRADA'; referencia: string; faltaDepois: number; proxima: { numero: number; valor: number; vencimento: string } | null; restantes: number; ficaDevendo: { numero: number; valor: number; vencimento: string } | null }
export interface PagamentoVendaNovo {
  legacyRecebimentoId: number
  tipo: 'ENTRADA' | 'PARCELA'
  data: string
  valorTotal: number
  itens: { numeroParcela: number; valor: number; antes: EstadoParcelaVenda }[]
  resumo: ResumoReciboVenda
  criadoEm: string | null
}
export interface VendaNova {
  legacyId: number
  bemLegacyId: number
  clienteLegacyId: number
  indicadorLegacyId: number | null
  pct: number
  dataVenda: string
  entrada: number
  troca: number
  trocaBemLegacyId: number | null
  investido: number
  total: number
  status: 'ATIVA' | 'QUITADA'
  observacoes: string | null
  parcelas: ParcelaVendaNova[]
  pagamentos: PagamentoVendaNovo[]
  criadoEm: string | null
}
export type CodigoAvisoVenda = 'total_diferente' | 'entrada_diferente' | 'troca_diferente' | 'recebimento_realocado' | 'recebimento_dividido' | 'recebimento_excedente' | 'reparcelada' | 'pct_fora_da_faixa' | 'sem_bem'

const brData = (iso: string | null) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : '' }

export function transformarVenda(v: VendaAntiga, estado: EstadoVendasAntigo): { novo: VendaNova | null; avisos: CodigoAvisoVenda[]; erro?: string } {
  const avisos = new Set<CodigoAvisoVenda>()
  if (v.status !== 'ATIVA' && v.status !== 'QUITADA') return { novo: null, avisos: [], erro: `venda com status ${v.status} não é importada` }
  if (!estado.bens.some((b) => b.id === v.bemId)) return { novo: null, avisos: [], erro: 'o aparelho da venda não está no estoque do antigo' }
  const parcelasAntigas = estado.parcelas.filter((p) => p.vendaId === v.id).sort((a, b) => a.numero - b.numero)
  const recs = estado.recebimentos.filter((r) => r.vendaId === v.id).sort((a, b) => a.dataRecebimento.localeCompare(b.dataRecebimento) || a.id - b.id)

  const parcelas: ParcelaVendaNova[] = parcelasAntigas.map((p, i) => ({ legacyId: p.id, numero: i + 1, vencimento: p.vencimento, vencimentoOriginal: p.vencimentoOriginal, valor: p.valor, desconto: 0, quitadaEm: null, pago: 0 }))
  const indice = new Map(parcelasAntigas.map((p, i) => [p.id, i]))
  const totalParcelas = arred(parcelas.reduce((x, p) => x + p.valor, 0))
  const totalCalculado = arred(v.entrada + v.trocaValor + totalParcelas)
  if (Math.abs(totalCalculado - v.valorTotal) > 0.009) avisos.add('total_diferente')

  const entradaRecebida = arred(recs.filter((r) => r.tipo === 'ENTRADA').reduce((x, r) => x + r.valor, 0))
  const trocaRecebida = arred(recs.filter((r) => r.tipo === 'TROCA').reduce((x, r) => x + r.valor, 0))
  if (Math.abs(entradaRecebida - v.entrada) > 0.009) avisos.add('entrada_diferente')
  if (Math.abs(trocaRecebida - v.trocaValor) > 0.009) avisos.add('troca_diferente')

  const estadoDe = (p: ParcelaVendaNova): EstadoParcelaVenda => ({ vencimento: p.vencimento, vencimentoOriginal: p.vencimentoOriginal, desconto: p.desconto, quitadaEm: p.quitadaEm })
  const abertas = () => parcelas.filter((p) => falta(p) > 0.009)
  const resumoEntrada = (): ResumoReciboVenda => ({ tipo: 'ENTRADA', referencia: 'entrada', faltaDepois: totalParcelas, proxima: parcelas[0] ? { numero: 1, valor: parcelas[0].valor, vencimento: parcelas[0].vencimento } : null, restantes: parcelas.length, ficaDevendo: null })

  const pagamentos: PagamentoVendaNovo[] = []
  for (const r of recs) {
    if (r.tipo === 'TROCA') continue // a troca é só o valor na venda (o sistema novo não gera recibo dela)
    if (r.tipo === 'ENTRADA') {
      if (r.valor <= 0.009) continue
      pagamentos.push({ legacyRecebimentoId: r.id, tipo: 'ENTRADA', data: r.dataRecebimento, valorTotal: r.valor, itens: [], resumo: resumoEntrada(), criadoEm: r.criadoEm })
      continue
    }
    let restante = r.valor
    const itens: PagamentoVendaNovo['itens'] = []
    const alvoIdx = r.parcelaId !== null ? indice.get(r.parcelaId) : undefined
    const aplicar = (p: ParcelaVendaNova, quanto: number, desconto = 0) => {
      const antes = estadoDe(p)
      p.desconto = arred(p.desconto + desconto)
      p.pago = arred(p.pago + quanto)
      if (falta(p) <= 0.009) p.quitadaEm = r.dataRecebimento
      itens.push({ numeroParcela: p.numero, valor: arred(quanto), antes })
      restante = arred(restante - quanto)
    }
    let foiParaOAlvo = false
    if (alvoIdx !== undefined) {
      const p = parcelas[alvoIdx]
      const quanto = Math.min(r.valor, Math.max(0, arred(p.valor - p.pago - p.desconto - r.desconto)))
      if (quanto > 0.009 || r.desconto > 0) { aplicar(p, quanto, r.desconto); foiParaOAlvo = true }
    }
    if (!foiParaOAlvo) avisos.add('recebimento_realocado')
    if (restante > 0.009) {
      if (foiParaOAlvo) avisos.add('recebimento_dividido')
      for (const p of abertas()) { if (restante <= 0.009) break; aplicar(p, Math.min(restante, falta(p))) }
    }
    if (restante > 0.009) {
      // recebeu mais do que a venda: a última parcela cresce para guardar o excedente (nada se perde)
      const ultima = parcelas[parcelas.length - 1]
      if (!ultima) { return { novo: null, avisos: [...avisos], erro: 'recebimento de parcela numa venda sem parcelas' } }
      ultima.valor = arred(ultima.valor + restante); aplicar(ultima, restante); avisos.add('recebimento_excedente')
    }
    if (!itens.length) continue // recebimento zerado sem desconto
    const em = abertas().sort((a, b) => a.numero - b.numero)
    const primeiro = parcelas.find((p) => p.numero === itens[0].numeroParcela)!
    pagamentos.push({
      legacyRecebimentoId: r.id, tipo: 'PARCELA', data: r.dataRecebimento, valorTotal: arred(itens.reduce((x, i) => x + i.valor, 0)), itens, criadoEm: r.criadoEm,
      resumo: {
        tipo: 'PARCELAS', referencia: referencia(itens.map((i) => i.numeroParcela), parcelas.length),
        faltaDepois: arred(totalParcelas > 0 ? parcelas.reduce((x, p) => x + Math.max(0, falta(p)), 0) : 0),
        proxima: em[0] ? { numero: em[0].numero, valor: falta(em[0]), vencimento: em[0].vencimento } : null, restantes: em.length,
        ficaDevendo: falta(primeiro) > 0.009 ? { numero: primeiro.numero, valor: falta(primeiro), vencimento: primeiro.vencimento } : null,
      },
    })
  }

  const totalNovo = arred(v.entrada + v.trocaValor + parcelas.reduce((x, p) => x + p.valor, 0))
  const faltaTotal = arred(parcelas.reduce((x, p) => x + Math.max(0, falta(p)), 0))
  const notas: string[] = []
  if (v.observacoes?.trim()) notas.push(v.observacoes.trim())
  for (const a of estado.ajustes.filter((x) => x.vendaId === v.id && x.tipo === 'REPARCELAMENTO')) { notas.push(`Reparcelada em ${brData(a.criadoEm)} (histórico do sistema antigo).`); avisos.add('reparcelada') }
  let pct = v.percentualParceiro / 100
  if (v.indicadorId === null) pct = 0
  else if (pct < 0 || pct > 1) { avisos.add('pct_fora_da_faixa'); pct = Math.min(1, Math.max(0, pct)) }

  return {
    avisos: [...avisos],
    novo: {
      legacyId: v.id, bemLegacyId: v.bemId, clienteLegacyId: v.clienteId, indicadorLegacyId: v.indicadorId, pct, dataVenda: v.dataVenda, entrada: v.entrada, troca: v.trocaValor,
      trocaBemLegacyId: v.trocaBemId, investido: v.valorInvestido, total: totalNovo, status: faltaTotal <= 0.009 ? 'QUITADA' : 'ATIVA', observacoes: notas.join('\n') || null, parcelas, pagamentos, criadoEm: v.criadoEm,
    },
  }
}
