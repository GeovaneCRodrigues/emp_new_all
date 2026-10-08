import type { ListaCobrancas, PagamentoView, Recibo, Registrado } from '../services/recebimentos.service.js'

export const reciboView = (r: Recibo) => r
export const registradoView = (r: Registrado) => ({ recibo: r.recibo, efeitos: r.efeitos, vendaQuitada: r.vendaQuitada })
export const pagamentosView = (ps: PagamentoView[]) => ps

export const cobrancasView = (l: ListaCobrancas) => ({
  itens: l.itens.map((x) => ({
    vendaId: x.vendaId, parcela: x.numero, nParcelas: x.nParcelas, vencimento: x.vencimento, vencimentoOriginal: x.vencimentoOriginal, valor: x.valor, pago: x.pago, falta: x.falta,
    atrasoDias: x.atrasoDias, cliente: x.cliente, aparelho: x.modelo, ultimaTransacaoId: x.ultimaTransacaoId, ultimoRecebimentoEm: x.ultimoRecebimentoEm,
  })),
  total: l.total, valorTotal: l.valorTotal, pagina: l.pagina, limite: l.limite, contagens: l.contagens,
})
