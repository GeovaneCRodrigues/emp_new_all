import type { Perfil } from '../../../shared/perfis.js'
import type { Cliente } from '../models/types.js'
import type { ResultadoLista, ResultadoSalvar } from '../services/clientes.service.js'

/** O indicador enxerga só o necessário para acompanhar o cliente que indicou: nada de CPF, RG nem endereço. */
export function clienteView(c: Cliente, perfil: Perfil) {
  const base = { id: c.id, nome: c.nome, fone: c.fone, desde: c.desde }
  if (perfil === 'INDICADOR') return base
  return { ...base, cpf: c.cpf, rg: c.rg, endereco: c.endereco, origem: c.origem, responsavelId: c.responsavelId, indicadorId: c.indicadorId }
}

export const listaView = (r: ResultadoLista, perfil: Perfil) => ({
  itens: r.itens.map((c) => clienteView(c, perfil)),
  total: r.total,
  pagina: r.pagina,
  limite: r.limite,
})

export const salvoView = (r: ResultadoSalvar, perfil: Perfil) => ({ cliente: clienteView(r.cliente, perfil), avisos: r.avisos })
