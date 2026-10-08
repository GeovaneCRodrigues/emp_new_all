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

export type EstadoParcela = { vencimento: string; vencimentoOriginal: string | null; desconto: number; quitadaEm: string | null }

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
