import type { Perfil } from '../../../shared/perfis.js'
import { arred2 } from '../../vendas/services/calculo.js'
import type { EmprestimoCalculado, ResultadoLista, ResumoEmprestimos } from '../services/emprestimos.service.js'

/**
 * Só o admin recebe capital, taxa, lucro e a parte do indicador: para o cobrador esses campos
 * nem existem na resposta (não vêm zerados).
 */
export function emprestimoView(c: EmprestimoCalculado, perfil: Perfil) {
  const e = c.emprestimo
  const base = {
    id: e.id, cliente: e.cliente, modalidade: e.modalidade, dataEmprestimo: e.dataEmprestimo, observacoes: e.observacoes,
    nParcelas: e.parcelas.length, valorParcela: e.parcelas[0]?.valor ?? 0,
    total: c.total, recebido: c.recebido, falta: c.falta, atrasadas: c.atrasadas, status: c.status,
    parcelas: e.parcelas.map((p) => ({
      numero: p.numero, vencimento: p.vencimento, vencimentoOriginal: p.vencimentoOriginal, valor: p.valor, desconto: p.desconto, pago: p.pago,
      falta: arred2(p.valor - p.pago - p.desconto), quitadaEm: p.quitadaEm,
    })),
  }
  if (perfil !== 'ADMIN') return base
  return {
    ...base,
    indicador: e.indicador, capital: e.capital, taxa: e.taxa,
    lucroTotal: c.lucroTotal, seuLucro: c.seuLucro, lucroRealizado: c.lucroRealizado, capitalDeVolta: c.capitalDeVolta,
    percentualIndicador: e.pct, parteIndicador: arred2(c.lucroTotal > 0 ? c.lucroTotal * e.pct : 0),
  }
}

export const listaView = (r: ResultadoLista, perfil: Perfil) => ({ itens: r.itens.map((c) => emprestimoView(c, perfil)), total: r.total, pagina: r.pagina, limite: r.limite })
export const resumoView = (r: ResumoEmprestimos, perfil: Perfil) => (perfil === 'ADMIN' ? r : { aReceber: r.aReceber })
