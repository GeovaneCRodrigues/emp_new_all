import { addDia } from '../../../shared/datas.js'
import { arred2 } from '../../vendas/services/calculo.js'

export type RestoPagamento = 'FICA' | 'DESCONTO'

export type ParcelaAberta = {
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
export type EstadoParcela = { vencimento: string; vencimentoOriginal: string | null; desconto: number; quitadaEm: string | null; valor?: number }

export type PedidoRecebimento = {
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
  /** quitação: o empréstimo foi encerrado; `desconto` é o que o cliente não pagou do devido e `perdoado` o juro que ainda não tinha vencido */
  | { tipo: 'QUITACAO'; desconto: number; perdoado: number }

export type ItemRecebimento = { parcelaId: number; numero: number; valorPago: number; antes: EstadoParcela; depois: EstadoParcela; faltaDepois: number }

export type ResultadoRecebimento = { itens: ItemRecebimento[]; efeitos: EfeitoRecebimento[]; valorTotal: number }

/** Erro de regra de negócio (vira 400/409 na camada de cima). */
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
 * O que um recebimento faz nas parcelas. Não mexe em nada: devolve o que mudaria.
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

  // a parcela escolhida ficou aberta: ou o resto fica devendo (com data nova) ou vira desconto
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


export type AjusteParcela = { parcelaId: number; numero: number; antes: EstadoParcela; depois: EstadoParcela }
export type ResultadoJuros = ResultadoRecebimento & { amortizacao: number; capitalRestante: number; ajustes: AjusteParcela[] }

/**
 * Recebimento de um empréstimo SÓ JUROS. Regra do negócio:
 *  - o valor paga primeiro o que falta da parcela escolhida (o juro do mês);
 *  - o que passar disso (o excedente) é descontado do CAPITAL;
 *  - o juro das parcelas seguintes é recalculado, na mesma taxa, sobre o capital que sobrou;
 *  - se o excedente zera o capital, o empréstimo quita e as parcelas seguintes ficam zeradas.
 * Pagou menos que a parcela: vale a regra de sempre (o resto fica devendo ou vira desconto).
 * `capitalAberto` é o capital que ainda não foi amortizado; `taxa` é % ao mês.
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
  if (excedente > capital + 0.009) {
    throw new ErroRecebimento('EXCEDE_DIVIDA', `O valor passa do que falta pagar (faltam ${arred2(devidoAlvo + capital).toFixed(2).replace('.', ',')})`)
  }

  // 1) a parcela escolhida é paga cheia (juro do mês)
  const base = calcularRecebimento(parcelas, { ...p, valor: devidoAlvo })
  // 2) o excedente reduz o capital; 3) o juro do que falta pagar é recalculado
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


export type PlanoQuitacao = {
  /** o que cobrar de cada parcela em aberto (juro vencido; sem juro por vencer, a menos que se escolha cobrar) */
  cobrancas: { parcela: ParcelaAberta; cobrar: number }[]
  capital: number
  /** tudo que se cobra para quitar: os juros acima + o capital em aberto */
  cobrado: number
  /** juro de parcelas que ainda não venceram e ficam de fora */
  perdoado: number
  /** a próxima parcela ainda não vencida (só juros): dá para escolher cobrar o juro dela */
  proxima: { numero: number; vencimento: string; valor: number } | null
}

/**
 * O que quitar um empréstimo custa. Só juros (`capitalAberto` informado): juros das parcelas JÁ VENCIDAS em aberto + o capital;
 * o juro de quem ainda não venceu fica de fora, salvo `cobrarProximo` (cobra o da próxima). Os demais empréstimos: tudo que falta.
 */
export function planoQuitacao(parcelas: ParcelaAberta[], o: { data: string; cobrarProximo?: boolean; capitalAberto?: number | null }): PlanoQuitacao {
  const ordenadas = parcelas.slice().sort((a, b) => a.numero - b.numero)
  const abertas = ordenadas.filter((x) => falta(x) > 0.009)
  const juros = o.capitalAberto !== null && o.capitalAberto !== undefined
  const capital = juros ? arred2(Math.max(0, o.capitalAberto!)) : 0
  const ultima = ordenadas[ordenadas.length - 1]
  const proxima = juros ? (abertas.find((x) => x.vencimento > o.data) ?? null) : null
  // a última parcela leva o capital junto: o juro dela é o que passa do capital
  const soJuro = (x: ParcelaAberta) => (juros && x.id === ultima.id ? Math.max(0, arred2(falta(x) - capital)) : falta(x))
  let perdoado = 0
  const cobrancas = abertas.map((x) => {
    const entra = !juros || x.vencimento <= o.data || (o.cobrarProximo === true && proxima?.id === x.id)
    if (!entra) perdoado = arred2(perdoado + soJuro(x))
    return { parcela: x, cobrar: entra ? soJuro(x) : 0 }
  })
  const jurosCobrados = arred2(cobrancas.reduce((t, c) => t + c.cobrar, 0))
  return { cobrancas, capital, cobrado: arred2(jurosCobrados + capital), perdoado, proxima: proxima ? { numero: proxima.numero, vencimento: proxima.vencimento, valor: soJuro(proxima) } : null }
}

export type ResultadoQuitacao = ResultadoJuros & { cobrado: number; desconto: number; perdoado: number }

/**
 * Quita o empréstimo de uma vez. Recebe `valor` (até o `cobrado` do plano; menos que isso, a diferença é desconto e sai do lucro).
 * O valor paga os juros em ordem e depois o capital (amortização); a falta fica como desconto, do fim para o começo.
 * Todas as parcelas em aberto terminam zeradas: o juro por vencer que ficou de fora some do valor delas (não é desconto).
 */
export function calcularQuitacao(parcelas: ParcelaAberta[], p: { valor?: number; data: string; cobrarProximo?: boolean }, o: { capitalAberto: number | null }): ResultadoQuitacao {
  const plano = planoQuitacao(parcelas, { data: p.data, cobrarProximo: p.cobrarProximo, capitalAberto: o.capitalAberto })
  if (plano.cobrado <= 0.009) throw new ErroRecebimento('PARCELA_PAGA', 'Não há nada a quitar neste empréstimo')
  const valor = arred2(p.valor ?? plano.cobrado)
  if (!Number.isFinite(valor) || valor <= 0) throw new ErroRecebimento('VALOR_INVALIDO', 'Informe quanto foi recebido')
  if (valor > plano.cobrado + 0.009) throw new ErroRecebimento('EXCEDE_DIVIDA', `O valor passa do que falta pagar (faltam ${plano.cobrado.toFixed(2).replace('.', ',')})`)

  let resto = valor
  const linhas = plano.cobrancas.map(({ parcela: x, cobrar }) => {
    const pago = arred2(Math.min(cobrar, resto)); resto = arred2(resto - pago)
    const desconto = arred2(cobrar - pago)
    const novoValor = arred2(x.pago + x.desconto + pago + desconto) // falta zero depois
    const mudaValor = Math.abs(novoValor - x.valor) > 0.004
    const antes: EstadoParcela = { vencimento: x.vencimento, vencimentoOriginal: x.vencimentoOriginal, desconto: x.desconto, quitadaEm: x.quitadaEm, ...(mudaValor ? { valor: x.valor } : {}) }
    const depois: EstadoParcela = { ...antes, desconto: arred2(x.desconto + desconto), quitadaEm: p.data, ...(mudaValor ? { valor: novoValor } : {}) }
    return { x, pago, desconto, antes, depois }
  })
  const amortizacao = arred2(Math.min(plano.capital, resto))

  // pelo menos uma parcela leva o recebimento (é ela que liga o pagamento ao empréstimo); as outras que mudam entram como ajuste
  const mudam = linhas.filter((l) => l.pago > 0.009 || l.desconto > 0.009 || l.depois.valor !== undefined)
  const comPagamento = mudam.filter((l) => l.pago > 0.009)
  const doRecibo = comPagamento.length ? comPagamento : mudam.slice(0, 1)
  const itens: ItemRecebimento[] = doRecibo.map((l) => ({ parcelaId: l.x.id, numero: l.x.numero, valorPago: l.pago, antes: l.antes, depois: l.depois, faltaDepois: 0 }))
  const ajustes: AjusteParcela[] = mudam.filter((l) => !doRecibo.includes(l)).map((l) => ({ parcelaId: l.x.id, numero: l.x.numero, antes: l.antes, depois: l.depois }))
  if (!itens.length) throw new ErroRecebimento('PARCELA_PAGA', 'Não há nada a quitar neste empréstimo')

  const desconto = arred2(plano.cobrado - valor)
  const efeitos: EfeitoRecebimento[] = [
    ...itens.map((i): EfeitoRecebimento => ({ tipo: 'QUITA', numero: i.numero })),
    ...linhas.filter((l) => l.desconto > 0.009).map((l): EfeitoRecebimento => ({ tipo: 'DESCONTO', numero: l.x.numero, valor: l.desconto })),
    ...(amortizacao > 0.009 ? [{ tipo: 'AMORTIZA', valor: amortizacao, capitalRestante: 0 } as EfeitoRecebimento] : []),
    { tipo: 'QUITACAO', desconto, perdoado: plano.perdoado },
  ]
  return { itens, efeitos, valorTotal: valor, amortizacao, capitalRestante: 0, ajustes, cobrado: plano.cobrado, desconto, perdoado: plano.perdoado }
}
