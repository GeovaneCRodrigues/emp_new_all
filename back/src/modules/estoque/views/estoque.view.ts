import type { Perfil } from '../../../shared/perfis.js'
import type { Aparelho, ResumoEstoque } from '../models/types.js'
import type { ResultadoLista } from '../services/estoque.service.js'

/**
 * O vendedor nunca recebe custo, extras nem observações: os campos nem existem na resposta
 * (não é "vem zerado": não vem). Só o admin recebe tudo.
 */
export function aparelhoView(a: Aparelho, perfil: Perfil) {
  const base = {
    id: a.id, modelo: a.modelo, gb: a.gb, cor: a.cor, bateria: a.bateria, condicao: a.condicao, imei: a.imei, preco: a.preco,
    estado: a.estado, origem: a.origem, dataCompra: a.dataCompra, paraCliente: a.paraCliente,
  }
  if (perfil !== 'ADMIN') return base
  return { ...base, custo: a.custo, extras: a.extras, observacoes: a.observacoes }
}

export const listaView = (r: ResultadoLista, perfil: Perfil) => ({ itens: r.itens.map((a) => aparelhoView(a, perfil)), total: r.total, pagina: r.pagina, limite: r.limite })

export function resumoView(r: ResumoEstoque, perfil: Perfil) {
  const base = { disponiveis: r.disponiveis, encomendados: r.encomendados, valorEmVitrine: r.valorEmVitrine }
  return perfil === 'ADMIN' ? { ...base, capitalParado: r.capitalParado, margemMedia: r.margemMedia } : base
}
