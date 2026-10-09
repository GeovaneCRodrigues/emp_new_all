import type { Perfil } from '../../../shared/perfis.js'
import { partesDoIndicador } from '../../repasses/services/calculo.js'
import { arred2 } from '../services/calculo.js'
import type { ResultadoLista, ResumoVendas, VendaCalculada } from '../services/vendas.service.js'

/**
 * Só o admin recebe custo, lucro e a parte do indicador: para os outros perfis esses campos
 * nem existem na resposta (não vêm zerados).
 */
export function vendaView(c: VendaCalculada, perfil: Perfil) {
  const v = c.venda
  const base = {
    id: v.id, aparelho: v.aparelho, cliente: v.cliente, indicador: v.indicador, dataVenda: v.dataVenda,
    precoAcordado: v.precoAcordado, entrada: v.entrada, troca: v.troca, jurosPct: v.jurosPct,
    nParcelas: v.parcelas.length, valorParcela: v.parcelas[0]?.valor ?? 0,
    total: c.total, recebido: c.recebido, falta: c.falta, atrasadas: c.atrasadas, status: c.status, contrato: v.contrato, retomada: v.retomada,
    parcelas: v.parcelas.map((p) => ({
      numero: p.numero, vencimento: p.vencimento, vencimentoOriginal: p.vencimentoOriginal, valor: p.valor, desconto: p.desconto, pago: p.pago,
      falta: arred2(p.valor - p.pago - p.desconto), quitadaEm: p.quitadaEm, acordo: p.acordo,
    })),
  }
  // o indicador acompanha a venda dele: a parte dele (prevista e já liberada), nunca o custo nem o lucro da loja
  if (perfil === 'INDICADOR') {
    const descontos = arred2(v.parcelas.reduce((x, p) => x + p.desconto, 0))
    const { parte, liberado } = partesDoIndicador({ total: c.total, descontos, recebido: c.recebido, investido: v.investido, pct: v.pct })
    // o motivo da retomada é anotação interna da loja
    return { ...base, retomada: v.retomada ? { em: v.retomada.em, motivo: null } : null, percentualIndicador: v.pct, suaParte: parte, jaLiberado: liberado }
  }
  if (perfil !== 'ADMIN') return base
  return {
    ...base,
    custoNoDia: v.investido, lucroTotal: c.lucroTotal, seuLucro: c.seuLucro, lucroRealizado: c.lucroRealizado, capitalDeVolta: c.capitalDeVolta,
    percentualIndicador: v.pct, parteIndicador: arred2(c.lucroTotal > 0 ? c.lucroTotal * v.pct : 0),
  }
}

export const listaView = (r: ResultadoLista, perfil: Perfil) => ({ itens: r.itens.map((c) => vendaView(c, perfil)), total: r.total, pagina: r.pagina, limite: r.limite })

export const resumoView = (r: ResumoVendas, perfil: Perfil) => (perfil === 'ADMIN' ? r : { aReceber: r.aReceber })
