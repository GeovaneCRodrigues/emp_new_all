import { addDia } from './datas'
import { arred2 } from './format'

export type RestoPagamento = 'FICA' | 'DESCONTO'

export interface ParcelaAberta {
  id: number
  numero: number
  vencimento: string
  vencimentoOriginal: string | null
  valor: number
  desconto: number
  /** quanto já entrou (recebimentos não desfeitos) */
  pago: number
  quitadaEm: string | null
}

/** `valor` só aparece quando o recebimento muda o valor da parcela (só juros com amortização). */
export interface EstadoParcela { vencimento: string; vencimentoOriginal: string | null; desconto: number; quitadaEm: string | null; valor?: number }

export interface PedidoRecebimento {
  /** parcela escolhida */
  numero: number
  valor: number
  data: string
  hoje: string
  /** o que fazer quando pagou menos que a parcela */
  resto?: RestoPagamento
  /** nova data do restante quando `resto` é FICA */
  novoVenc?: string
}

export type EfeitoRecebimento =
  | { tipo: 'QUITA'; numero: number }
  | { tipo: 'ABATE'; numero: number; valor: number }
  | { tipo: 'FICA'; numero: number; resta: number; vencimento: string }
  | { tipo: 'DESCONTO'; numero: number; valor: number }
  /** só juros: o que passou do juro da parcela abateu o capital */
  | { tipo: 'AMORTIZA'; valor: number; capitalRestante: number }

export interface ItemRecebimento { parcelaId: number; numero: number; valorPago: number; antes: EstadoParcela; depois: EstadoParcela; faltaDepois: number }
export interface ResultadoRecebimento { itens: ItemRecebimento[]; efeitos: EfeitoRecebimento[]; valorTotal: number }

/** Erro de regra de negócio do recebimento. */
export class ErroRecebimento extends Error {
  constructor(public readonly codigo: 'PARCELA_INEXISTENTE' | 'PARCELA_PAGA' | 'VALOR_INVALIDO' | 'EXCEDE_DIVIDA' | 'RESTO_OBRIGATORIO' | 'VENCIMENTO_INVALIDO', mensagem: string) {
    super(mensagem)
  }
}

export const falta = (p: Pick<ParcelaAberta, 'valor' | 'pago' | 'desconto'>) => arred2(p.valor - p.pago - p.desconto)

/** Vencimento sugerido para o restante: mantém a data se ainda não venceu, senão +7 dias. */
export const vencPadraoResto = (vencimento: string, hoje: string) => (vencimento > hoje ? vencimento : addDia(hoje, 7))

const MAX_DIAS_REMARCAR = 365

/**
 * O que um recebimento faz nas parcelas (mesma regra do backend). Não mexe em nada: devolve o que mudaria.
 *  - pagou o certo: quita a parcela;
 *  - pagou menos: o resto fica devendo (com nova data) OU vira desconto (quita, e sai do lucro);
 *  - pagou mais: o excedente abate as próximas parcelas, em ordem.
 */
export function calcularRecebimento(parcelas: ParcelaAberta[], p: PedidoRecebimento): ResultadoRecebimento {
  if (!Number.isFinite(p.valor) || p.valor <= 0) throw new ErroRecebimento('VALOR_INVALIDO', 'Informe quanto foi recebido')
  const ordenadas = parcelas.slice().sort((a, b) => a.numero - b.numero)
  const alvo = ordenadas.find((x) => x.numero === p.numero)
  if (!alvo) throw new ErroRecebimento('PARCELA_INEXISTENTE', 'Parcela não encontrada')
  if (falta(alvo) <= 0.009) throw new ErroRecebimento('PARCELA_PAGA', 'Esta parcela já está paga')

  const valor = arred2(p.valor)
  const itens: ItemRecebimento[] = []
  const efeitos: EfeitoRecebimento[] = []
  let sobra = valor

  for (const parcela of ordenadas.filter((x) => x.numero >= p.numero && falta(x) > 0.009)) {
    if (sobra <= 0.009) break
    const aplicado = arred2(Math.min(sobra, falta(parcela)))
    sobra = arred2(sobra - aplicado)
    const antes: EstadoParcela = { vencimento: parcela.vencimento, vencimentoOriginal: parcela.vencimentoOriginal, desconto: parcela.desconto, quitadaEm: parcela.quitadaEm }
    const faltaDepois = arred2(falta(parcela) - aplicado)
    itens.push({ parcelaId: parcela.id, numero: parcela.numero, valorPago: aplicado, antes, depois: { ...antes, quitadaEm: faltaDepois <= 0.009 ? p.data : null }, faltaDepois })
  }
  if (sobra > 0.009) throw new ErroRecebimento('EXCEDE_DIVIDA', `O valor passa do que falta pagar (faltam ${arred2(valor - sobra).toFixed(2).replace('.', ',')})`)

  const primeiro = itens[0]
  if (primeiro.faltaDepois > 0.009) {
    if (p.resto !== 'FICA' && p.resto !== 'DESCONTO') throw new ErroRecebimento('RESTO_OBRIGATORIO', 'Pagou menos que a parcela: diga se o resto fica devendo ou vira desconto')
    if (p.resto === 'DESCONTO') {
      efeitos.push({ tipo: 'DESCONTO', numero: primeiro.numero, valor: primeiro.faltaDepois })
      primeiro.depois = { ...primeiro.depois, desconto: arred2(primeiro.antes.desconto + primeiro.faltaDepois), quitadaEm: p.data }
      primeiro.faltaDepois = 0
    } else {
      const novo = p.novoVenc ?? vencPadraoResto(primeiro.antes.vencimento, p.hoje)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(novo) || novo < p.hoje || novo > addDia(p.hoje, MAX_DIAS_REMARCAR)) throw new ErroRecebimento('VENCIMENTO_INVALIDO', 'A nova data precisa ser de hoje até um ano à frente')
      efeitos.push({ tipo: 'FICA', numero: primeiro.numero, resta: primeiro.faltaDepois, vencimento: novo })
      if (novo !== primeiro.antes.vencimento) primeiro.depois = { ...primeiro.depois, vencimento: novo, vencimentoOriginal: primeiro.antes.vencimentoOriginal ?? primeiro.antes.vencimento }
    }
  } else efeitos.push({ tipo: 'QUITA', numero: primeiro.numero })

  for (const it of itens.slice(1)) efeitos.push(it.faltaDepois <= 0.009 ? { tipo: 'QUITA', numero: it.numero } : { tipo: 'ABATE', numero: it.numero, valor: it.valorPago })
  return { itens, efeitos, valorTotal: valor }
}

/** "parcela 2/12" ou "parcelas 2 a 4 de 12". */
export function referencia(numeros: number[], total: number): string {
  const ns = numeros.slice().sort((a, b) => a - b)
  return ns.length > 1 ? `parcelas ${ns[0]} a ${ns[ns.length - 1]} de ${total}` : `parcela ${ns[0]}/${total}`
}

/** A prévia em português do que o recebimento vai fazer ("Quita a 1ª e abate R$ 150,00 da 3ª"). */
export function descreverEfeitos(efeitos: EfeitoRecebimento[], fmt: (v: number) => string, dmy: (iso: string) => string): string {
  const partes = efeitos.map((e) => {
    if (e.tipo === 'QUITA') return `quita a ${e.numero}ª`
    if (e.tipo === 'ABATE') return `abate ${fmt(e.valor)} da ${e.numero}ª`
    if (e.tipo === 'DESCONTO') return `dá ${fmt(e.valor)} de desconto na ${e.numero}ª`
    if (e.tipo === 'AMORTIZA') return `abate ${fmt(e.valor)} do capital (sobram ${fmt(e.capitalRestante)})`
    return `a ${e.numero}ª fica com ${fmt(e.resta)}, para ${dmy(e.vencimento)}`
  })
  const texto = partes.join(', ')
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

export interface AjusteParcela { parcelaId: number; numero: number; antes: EstadoParcela; depois: EstadoParcela }
export interface ResultadoJuros extends ResultadoRecebimento { amortizacao: number; capitalRestante: number; ajustes: AjusteParcela[] }

/**
 * Recebimento de um empréstimo SÓ JUROS (mesma regra do backend):
 *  - o valor paga primeiro o que falta da parcela escolhida (o juro do mês);
 *  - o que passar disso (o excedente) é descontado do CAPITAL;
 *  - o juro das parcelas seguintes é recalculado, na mesma taxa, sobre o capital que sobrou;
 *  - se o excedente zera o capital, o empréstimo quita e as parcelas seguintes ficam zeradas.
 * `capitalAberto` é o capital ainda não amortizado; `taxa` é % ao mês.
 */
export function calcularRecebimentoJuros(parcelas: ParcelaAberta[], p: PedidoRecebimento, o: { capitalAberto: number; taxa: number }): ResultadoJuros {
  if (!Number.isFinite(p.valor) || p.valor <= 0) throw new ErroRecebimento('VALOR_INVALIDO', 'Informe quanto foi recebido')
  const ordenadas = parcelas.slice().sort((a, b) => a.numero - b.numero)
  const alvo = ordenadas.find((x) => x.numero === p.numero)
  if (!alvo) throw new ErroRecebimento('PARCELA_INEXISTENTE', 'Parcela não encontrada')
  if (falta(alvo) <= 0.009) throw new ErroRecebimento('PARCELA_PAGA', 'Esta parcela já está paga')

  const valor = arred2(p.valor)
  const devidoAlvo = falta(alvo)
  const excedente = arred2(Math.max(0, valor - devidoAlvo))
  if (excedente <= 0.009) return { ...calcularRecebimento(parcelas, p), amortizacao: 0, capitalRestante: arred2(o.capitalAberto), ajustes: [] }

  const ultima = ordenadas[ordenadas.length - 1]
  if (alvo.numero === ultima.numero) throw new ErroRecebimento('EXCEDE_DIVIDA', `O valor passa do que falta pagar (faltam ${devidoAlvo.toFixed(2).replace('.', ',')})`)
  const capital = arred2(o.capitalAberto)
  if (excedente > capital + 0.009) throw new ErroRecebimento('EXCEDE_DIVIDA', `O valor passa do que falta pagar (faltam ${arred2(devidoAlvo + capital).toFixed(2).replace('.', ',')})`)

  const base = calcularRecebimento(parcelas, { ...p, valor: devidoAlvo })
  const capitalRestante = arred2(capital - excedente)
  const juro = arred2(capitalRestante * (o.taxa / 100))
  const ajustes: AjusteParcela[] = []
  for (const q of ordenadas.filter((x) => x.numero > alvo.numero && falta(x) > 0.009 && x.pago === 0 && x.desconto === 0)) {
    const novo = arred2(juro + (q.numero === ultima.numero ? capitalRestante : 0))
    if (novo === q.valor) continue
    const antes: EstadoParcela = { vencimento: q.vencimento, vencimentoOriginal: q.vencimentoOriginal, desconto: q.desconto, quitadaEm: q.quitadaEm, valor: q.valor }
    ajustes.push({ parcelaId: q.id, numero: q.numero, antes, depois: { ...antes, valor: novo, quitadaEm: novo <= 0.009 ? p.data : null } })
  }
  return { ...base, valorTotal: valor, efeitos: [...base.efeitos, { tipo: 'AMORTIZA', valor: excedente, capitalRestante }], amortizacao: excedente, capitalRestante, ajustes }
}
