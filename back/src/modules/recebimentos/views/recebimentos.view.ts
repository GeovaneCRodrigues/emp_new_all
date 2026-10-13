import type { ListaCobrancas, ResultadoCronograma, PagamentoView, Recibo, Registrado } from '../services/recebimentos.service.js'

export const reciboView = (r: Recibo) => r
export const registradoView = (r: Registrado) => ({ recibo: r.recibo, efeitos: r.efeitos, quitada: r.quitada, pedidoDescontoId: r.pedidoDescontoId })
export const pagamentosView = (ps: PagamentoView[]) => ps

type ItemCobranca = ListaCobrancas['itens'][number]
const itemCobrancaView = (x: ItemCobranca) => ({
  tipo: x.tipo, operacaoId: x.operacaoId, parcela: x.numero, nParcelas: x.nParcelas, vencimento: x.vencimento, vencimentoOriginal: x.vencimentoOriginal, valor: x.valor, pago: x.pago, falta: x.falta,
  atrasoDias: x.atrasoDias, cliente: x.cliente, aparelho: x.descricao, ultimaTransacaoId: x.ultimaTransacaoId, ultimoRecebimentoEm: x.ultimoRecebimentoEm, baixaPendente: x.baixaPendente,
})

export const cobrancasView = (l: ListaCobrancas) => ({
  itens: l.itens.map(itemCobrancaView),
  total: l.total, valorTotal: l.valorTotal, pagina: l.pagina, limite: l.limite, contagens: l.contagens,
})

/** O calendário: as mesmas linhas das cobranças, do mês inteiro. */
export const cronogramaView = (r: ResultadoCronograma) => ({ mes: r.mes, hoje: r.hoje, itens: r.itens.map(itemCobrancaView), cortado: r.cortado })
