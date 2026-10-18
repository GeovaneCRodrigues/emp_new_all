import type { Perfil } from '../../../shared/perfis.js'
import { partesDoIndicador } from '../../repasses/services/calculo.js'
import { jurosRecebidosSoJuros } from '../services/calculo.js'
import { arred2 } from '../../vendas/services/calculo.js'
import type { EmprestimoCalculado, ResultadoLista, ResumoEmprestimos } from '../services/emprestimos.service.js'

/**
 * Só o admin recebe capital, taxa, lucro e a parte do indicador: para o cobrador esses campos
 * nem existem na resposta (não vêm zerados).
 */
/**
 * O "plano" que o cartão e a ficha mostram. Empréstimo comum: todas as parcelas e o valor da primeira.
 * Depois de um acordo ou de uma unificação (`renegociado`): só o que ainda vem pela frente (as em aberto) e o valor da próxima,
 * porque o resto é histórico (o que já foi pago, vindo de antes). Quitado: volta ao plano inteiro.
 */
function planoDoEmprestimo(parcelas: EmprestimoCalculado['emprestimo']['parcelas']) {
  const renegociado = parcelas.some((p) => p.acordo !== null)
  const abertas = parcelas.filter((p) => p.acordo !== 'ENCERRADA' && arred2(p.valor - p.pago - p.desconto) > 0.009)
  const usa = renegociado && abertas.length ? abertas : parcelas
  return { renegociado, nParcelas: usa.length, valorParcela: usa[0]?.valor ?? 0 }
}

export function emprestimoView(c: EmprestimoCalculado, perfil: Perfil) {
  const e = c.emprestimo
  const plano = planoDoEmprestimo(e.parcelas)
  const base = {
    id: e.id, cliente: e.cliente, modalidade: e.modalidade, periodicidade: e.periodicidade, pulaDomingo: e.pulaDomingo, dataEmprestimo: e.dataEmprestimo, observacoes: e.observacoes,
    nParcelas: plano.nParcelas, valorParcela: plano.valorParcela, renegociado: plano.renegociado,
    total: c.total, recebido: c.recebido, falta: c.falta, atrasadas: c.atrasadas, status: c.status,
    parcelas: e.parcelas.map((p) => ({
      numero: p.numero, vencimento: p.vencimento, vencimentoOriginal: p.vencimentoOriginal, valor: p.valor, desconto: p.desconto, pago: p.pago,
      falta: arred2(p.valor - p.pago - p.desconto), quitadaEm: p.quitadaEm, acordo: p.acordo,
    })),
  }
  // o indicador acompanha o empréstimo dele: a parte dele (prevista e já liberada), nunca capital, taxa nem lucro da loja
  if (perfil === 'INDICADOR') {
    const descontos = arred2(e.parcelas.reduce((x, p) => x + p.desconto, 0))
    const { parte, liberado } = partesDoIndicador({ total: c.total, descontos, recebido: c.recebido, investido: e.capital, pct: e.pct, jurosRecebidos: jurosRecebidosSoJuros(e) })
    return { ...base, percentualIndicador: e.pct, suaParte: parte, jaLiberado: liberado }
  }
  if (perfil !== 'ADMIN') return base
  return {
    ...base,
    unificadoDe: e.unificadoDe, unificadoEm: e.unificadoEm,
    indicador: e.indicador, capital: e.capital, taxa: e.taxa, modoDivisao: e.modoDivisao,
    // só juros: o capital que ainda não foi amortizado (a prévia do recebimento precisa dele)
    capitalAberto: arred2(e.capital - e.amortizado),
    lucroTotal: c.lucroTotal, seuLucro: c.seuLucro, lucroRealizado: c.lucroRealizado, capitalDeVolta: c.capitalDeVolta,
    percentualIndicador: e.pct, parteIndicador: arred2(c.lucroTotal > 0 ? c.lucroTotal * e.pct : 0),
  }
}

export const listaView = (r: ResultadoLista, perfil: Perfil) => ({ itens: r.itens.map((c) => emprestimoView(c, perfil)), total: r.total, pagina: r.pagina, limite: r.limite })
export const resumoView = (r: ResumoEmprestimos, perfil: Perfil) => (perfil === 'ADMIN' ? r : { aReceber: r.aReceber })
