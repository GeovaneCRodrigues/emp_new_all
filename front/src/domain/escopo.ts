import type { Dados } from './dados'
import type { Bem, Perfil } from './types'

export interface Sessao {
  perfil: Perfil
  /** users.id (admin, vendedor, cobrador) */
  usuarioId?: number
  /** indicadores.id (quando o perfil é indicador) */
  indicadorId?: number
}

/** O que cada perfil pode ver na tela. */
export function permissoes(perfil: Perfil) {
  return {
    verCustoELucro: perfil === 'ADMIN',
    verEstoque: perfil === 'ADMIN' || perfil === 'VENDEDOR',
    darBaixa: perfil === 'ADMIN' || perfil === 'COBRADOR',
    darDesconto: perfil === 'ADMIN',
  }
}

const semCusto = (b: Bem): Bem => ({ ...b, custo: 0, extras: 0 })

/**
 * Filtra os dados pelo perfil. É o que o backend deve fazer em todo endpoint:
 * quem não é admin nunca recebe custo, e cada um só recebe o que é seu.
 */
export function aplicarEscopo(d: Dados, s: Sessao): Dados {
  if (s.perfil === 'ADMIN') return d

  const idsClientes = (ids: Iterable<number>) => new Set(ids)
  let clientesOk: Set<number>
  let vendas = d.vendas
  let emprestimos = d.emprestimos
  let indicadores: Dados['indicadores'] = []
  let repasses: Dados['repasses'] = []

  if (s.perfil === 'INDICADOR') {
    vendas = vendas.filter((v) => v.indicadorId === s.indicadorId)
    emprestimos = emprestimos.filter((e) => e.indicadorId === s.indicadorId)
    clientesOk = idsClientes([...vendas, ...emprestimos].map((o) => o.clienteId))
    indicadores = d.indicadores.filter((i) => i.id === s.indicadorId)
    repasses = d.repasses.filter((r) => r.indicadorId === s.indicadorId)
  } else {
    clientesOk = idsClientes(d.clientes.filter((c) => c.responsavelId === s.usuarioId).map((c) => c.id))
    vendas = vendas.filter((v) => clientesOk.has(v.clienteId) || v.vendedorId === s.usuarioId)
    emprestimos = s.perfil === 'COBRADOR' ? emprestimos.filter((e) => clientesOk.has(e.clienteId)) : []
  }

  const bemIds = new Set(vendas.map((v) => v.bemId))
  const bens =
    s.perfil === 'VENDEDOR'
      ? d.bens.map(semCusto) // vendedor vê o estoque inteiro, mas só com preço de venda
      : d.bens.filter((b) => bemIds.has(b.id)).map(semCusto)

  return {
    ...d,
    bens,
    vendas,
    emprestimos,
    clientes: d.clientes.filter((c) => clientesOk.has(c.id)),
    indicadores,
    repasses,
    usuarios: s.perfil === 'COBRADOR' || s.perfil === 'VENDEDOR' ? d.usuarios.filter((u) => u.id === s.usuarioId) : [],
  }
}
