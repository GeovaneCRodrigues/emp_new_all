import type { Knex } from 'knex'

/**
 * A "carteira" de quem não é administrador. O vendedor continua com os clientes em que ele é o responsável.
 * O cobrador NÃO usa o responsável: só enxerga o que vem dos indicadores que o administrador marcou para ele
 * (tabela `cobrador_indicadores`); sem nenhum marcado, não enxerga nada.
 *
 * `operacao` é o alias da venda/empréstimo na consulta (o indicador vem da operação, como na visão do indicador);
 * `cliente` é o alias do cliente. Sem `operacao` (lista de clientes), vale o indicador do cadastro do cliente ou o
 * de qualquer operação dele.
 */
const ELE_E_COBRADOR = `exists (select 1 from users uc where uc.id = ? and uc.perfil = 'COBRADOR')`

export function naCarteira(q: Knex.QueryBuilder, usuarioId: number, a: { cliente: string; operacao?: string }) {
  return q.where((w) => {
    w.whereRaw(`${a.cliente}.responsavel_id = ? and not ${ELE_E_COBRADOR}`, [usuarioId, usuarioId])
    if (a.operacao) {
      w.orWhereRaw(`exists (select 1 from cobrador_indicadores ci where ci.usuario_id = ? and ci.indicador_id = ${a.operacao}.indicador_id)`, [usuarioId])
    } else {
      w.orWhereRaw(`exists (select 1 from cobrador_indicadores ci where ci.usuario_id = ? and (ci.indicador_id = ${a.cliente}.indicador_id
        or exists (select 1 from vendas vv where vv.cliente_id = ${a.cliente}.id and vv.indicador_id = ci.indicador_id)
        or exists (select 1 from emprestimos ee where ee.cliente_id = ${a.cliente}.id and ee.indicador_id = ci.indicador_id)))`, [usuarioId])
    }
  })
}
