import type { Knex } from 'knex'

/**
 * O cobrador só enxerga as operações dos indicadores que o administrador marcou para ele.
 * Cria um indicador para cada cobrador, vincula, e devolve `donoDe(clienteId)`: o indicador a usar nas operações
 * dos clientes que são "da carteira" daquele cobrador (clienteId → indicador do cobrador responsável).
 */
export async function indicadoresDosCobradores(k: Knex, cobradores: Record<string, number>, clientes: Record<string, number>, donos: Record<string, string>) {
  const indicadorDe: Record<number, number> = {}
  for (const [chave, usuarioId] of Object.entries(cobradores)) {
    const [i] = await k('indicadores').insert({ nome: `Ind de ${chave}`, pct: 0.5 }).returning('id')
    await k('cobrador_indicadores').insert({ usuario_id: usuarioId, indicador_id: i.id })
    for (const [cli, dono] of Object.entries(donos)) if (dono === chave) indicadorDe[clientes[cli]] = i.id
  }
  return (clienteId: number): number | undefined => indicadorDe[clienteId]
}
