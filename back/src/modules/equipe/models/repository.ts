import type { Knex } from 'knex'
import { PAGO_PARCELA_SQL } from '../../../shared/sql.js'
import type { PerfilEquipe, Pessoa } from './types.js'

export interface EquipeRepository {
  listar(f: { hoje: string; inicioMes: string; fimMes: string }): Promise<Pessoa[]>
  buscar(id: number): Promise<{ id: number; nome: string; email: string; perfil: string; ativo: boolean; fone: string | null } | null>
  /** Cria o acesso com senha temporária. Lança 23505 se o e-mail já existe. */
  criar(d: { nome: string; email: string; senhaHash: string; perfil: Exclude<PerfilEquipe, 'ADMIN'>; fone: string | null }): Promise<number>
  atualizar(id: number, d: { nome?: string; fone?: string | null }): Promise<void>
  /** Ativa ou desativa. Ao desativar, derruba as sessões abertas. */
  definirAtivo(id: number, ativo: boolean): Promise<void>
}

type Linha = { id: number; nome: string; email: string; perfil: PerfilEquipe; fone: string | null; ativo: boolean; carteira: string; com_atraso: string; recebido: string; vendas: string; pedidos: string }

export function createEquipeRepository(db: Knex): EquipeRepository {
  return {
    async listar(f) {
      const ls = await db('users as u').whereIn('u.perfil', ['ADMIN', 'VENDEDOR', 'COBRADOR']).orderByRaw("case u.perfil when 'ADMIN' then 0 when 'COBRADOR' then 1 else 2 end, lower(u.nome)").select<Linha[]>(
        'u.id', 'u.nome', 'u.email', 'u.perfil', 'u.fone', 'u.ativo',
        db.raw('(select count(*) from clientes c where c.responsavel_id = u.id) as carteira'),
        db.raw(`(select count(distinct c.id) from clientes c join vendas v on v.cliente_id = c.id and v.status not in ('RETOMADA','CANCELADA') join venda_parcelas p on p.venda_id = v.id
                 where c.responsavel_id = u.id and p.vencimento < ? and (p.valor - ${PAGO_PARCELA_SQL} - p.desconto) > 0.009) as com_atraso`, [f.hoje]),
        db.raw('coalesce((select sum(t.valor_total) from transacoes_recebimento t where t.recebido_por = u.id and t.desfeita_em is null and t.data_recebimento >= ? and t.data_recebimento < ?), 0) as recebido', [f.inicioMes, f.fimMes]),
        db.raw("(select count(*) from vendas v where v.vendedor_id = u.id and v.status <> 'CANCELADA' and v.data_venda >= ? and v.data_venda < ?) as vendas", [f.inicioMes, f.fimMes]),
        db.raw("(select count(*) from aprovacoes a where a.solicitado_por = u.id and a.status = 'PENDENTE') as pedidos"),
      )
      return ls.map((l) => ({ id: l.id, nome: l.nome, email: l.email, perfil: l.perfil, fone: l.fone, ativo: l.ativo, carteira: Number(l.carteira), comAtraso: Number(l.com_atraso), recebidoNoMes: Number(l.recebido), vendasNoMes: Number(l.vendas), pedidosPendentes: Number(l.pedidos) }))
    },
    async buscar(id) {
      return (await db('users').where({ id }).whereIn('perfil', ['ADMIN', 'VENDEDOR', 'COBRADOR']).first('id', 'nome', 'email', 'perfil', 'ativo', 'fone')) ?? null
    },
    async criar(d) {
      const [{ id }] = await db('users').insert({ nome: d.nome, email: d.email.toLowerCase(), senha_hash: d.senhaHash, perfil: d.perfil, fone: d.fone, senha_temporaria: true }).returning('id')
      return id
    },
    async atualizar(id, d) {
      const u: Record<string, unknown> = { updated_at: db.fn.now() }
      if (d.nome !== undefined) u.nome = d.nome
      if (d.fone !== undefined) u.fone = d.fone
      await db('users').where({ id }).update(u)
    },
    async definirAtivo(id, ativo) {
      await db.transaction(async (trx) => {
        await trx('users').where({ id }).update({ ativo, updated_at: trx.fn.now() })
        if (!ativo) await trx('sessoes').where({ usuario_id: id }).whereNull('revogada_em').update({ revogada_em: trx.fn.now() })
      })
    },
  }
}
