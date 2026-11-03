import type { Knex } from 'knex'
import { PAGO_PARCELA_SQL } from '../../../shared/sql.js'
import type { PerfilEquipe, Pessoa } from './types.js'

/** O cliente `c` está na carteira da pessoa `u`: do cobrador, pelos indicadores marcados; dos demais, pelo responsável. */
const NA_CARTEIRA_SQL = `(case when u.perfil = 'COBRADOR'
  then exists (select 1 from cobrador_indicadores ci where ci.usuario_id = u.id and (ci.indicador_id = c.indicador_id
    or exists (select 1 from vendas vv where vv.cliente_id = c.id and vv.indicador_id = ci.indicador_id)
    or exists (select 1 from emprestimos ee where ee.cliente_id = c.id and ee.indicador_id = ci.indicador_id)))
  else c.responsavel_id = u.id end)`

export interface EquipeRepository {
  listar(f: { hoje: string; inicioMes: string; fimMes: string }): Promise<Pessoa[]>
  buscar(id: number): Promise<{ id: number; nome: string; email: string; perfil: PerfilEquipe; ativo: boolean; fone: string | null } | null>
  /** Cria o acesso com senha temporária. Lança 23505 se o e-mail já existe. */
  criar(d: { nome: string; email: string; senhaHash: string; perfil: Exclude<PerfilEquipe, 'INDICADOR'>; fone: string | null }): Promise<number>
  atualizar(id: number, d: { nome?: string; fone?: string | null; email?: string }): Promise<void>
  /** Ativa ou desativa. Ao desativar, derruba as sessões abertas. */
  definirAtivo(id: number, ativo: boolean): Promise<void>
  /** Muda o nível (vendedor <-> cobrador), derruba as sessões abertas e, se deixou de ser cobrador, limpa os indicadores dele. */
  definirPerfil(id: number, perfil: 'VENDEDOR' | 'COBRADOR'): Promise<void>
  /** Troca a senha por uma temporária: destrava o login e derruba as sessões abertas. */
  redefinirSenha(id: number, senhaHash: string): Promise<void>
  /** Quais destes ids são indicadores que existem. */
  indicadoresExistentes(ids: number[]): Promise<number[]>
  /** Troca de uma vez os indicadores que o cobrador atende. */
  definirIndicadores(usuarioId: number, ids: number[]): Promise<void>
}

type Linha = { ultimo: Date | null; bloqueado: boolean; temporaria: boolean; indicadores: number[] | null; id: number; nome: string; email: string; perfil: PerfilEquipe; fone: string | null; ativo: boolean; carteira: string; com_atraso: string; recebido: string; vendas: string; pedidos: string }

export function createEquipeRepository(db: Knex): EquipeRepository {
  return {
    async listar(f) {
      const ls = await db('users as u').whereIn('u.perfil', ['ADMIN', 'VENDEDOR', 'COBRADOR', 'INDICADOR']).orderByRaw("case u.perfil when 'ADMIN' then 0 when 'COBRADOR' then 1 when 'VENDEDOR' then 2 else 3 end, lower(u.nome)").select<Linha[]>(
        'u.id', 'u.nome', 'u.email', 'u.perfil', 'u.fone', 'u.ativo', 'u.senha_temporaria as temporaria',
        db.raw('(select max(s.criada_em) from sessoes s where s.usuario_id = u.id) as ultimo'),
        db.raw('(u.bloqueado_ate is not null and u.bloqueado_ate > now()) as bloqueado'),
        db.raw(`(select count(*) from clientes c where ${NA_CARTEIRA_SQL}) as carteira`),
        db.raw(`(select count(distinct c.id) from clientes c join vendas v on v.cliente_id = c.id and v.status not in ('RETOMADA','CANCELADA') join venda_parcelas p on p.venda_id = v.id
                 where ${NA_CARTEIRA_SQL} and p.vencimento < ? and (p.valor - ${PAGO_PARCELA_SQL} - p.desconto) > 0.009) as com_atraso`, [f.hoje]),
        db.raw('coalesce((select sum(t.valor_total) from transacoes_recebimento t where t.recebido_por = u.id and t.desfeita_em is null and t.data_recebimento >= ? and t.data_recebimento < ?), 0) as recebido', [f.inicioMes, f.fimMes]),
        db.raw("(select count(*) from vendas v where v.vendedor_id = u.id and v.status <> 'CANCELADA' and v.data_venda >= ? and v.data_venda < ?) as vendas", [f.inicioMes, f.fimMes]),
        db.raw('(select coalesce(array_agg(ci.indicador_id order by ci.indicador_id), \'{}\') from cobrador_indicadores ci where ci.usuario_id = u.id) as indicadores'),
        db.raw("(select count(*) from aprovacoes a where a.solicitado_por = u.id and a.status = 'PENDENTE') as pedidos"),
      )
      return ls.map((l) => ({ id: l.id, nome: l.nome, email: l.email, perfil: l.perfil, fone: l.fone, ativo: l.ativo, carteira: Number(l.carteira), comAtraso: Number(l.com_atraso), recebidoNoMes: Number(l.recebido), vendasNoMes: Number(l.vendas), pedidosPendentes: Number(l.pedidos), ultimoAcesso: l.ultimo ? new Date(l.ultimo).toISOString() : null, bloqueado: l.bloqueado, senhaTemporaria: l.temporaria, ...(l.perfil === 'COBRADOR' ? { indicadorIds: l.indicadores ?? [] } : {}) }))
    },
    async buscar(id) {
      return (await db('users').where({ id }).whereIn('perfil', ['ADMIN', 'VENDEDOR', 'COBRADOR', 'INDICADOR']).first('id', 'nome', 'email', 'perfil', 'ativo', 'fone')) ?? null
    },
    async criar(d) {
      const [{ id }] = await db('users').insert({ nome: d.nome, email: d.email.toLowerCase(), senha_hash: d.senhaHash, perfil: d.perfil, fone: d.fone, senha_temporaria: true }).returning('id')
      return id
    },
    async atualizar(id, d) {
      const u: Record<string, unknown> = { updated_at: db.fn.now() }
      if (d.nome !== undefined) u.nome = d.nome
      if (d.fone !== undefined) u.fone = d.fone
      if (d.email !== undefined) u.email = d.email.toLowerCase()
      await db('users').where({ id }).update(u)
    },
    async definirPerfil(id, perfil) {
      await db.transaction(async (trx) => {
        await trx('users').where({ id }).update({ perfil, updated_at: trx.fn.now() })
        if (perfil !== 'COBRADOR') await trx('cobrador_indicadores').where({ usuario_id: id }).delete()
        // o nível vai dentro do token de acesso: quem estava logado precisa entrar de novo
        await trx('sessoes').where({ usuario_id: id }).whereNull('revogada_em').update({ revogada_em: trx.fn.now() })
      })
    },
    async redefinirSenha(id, senhaHash) {
      await db.transaction(async (trx) => {
        await trx('users').where({ id }).update({ senha_hash: senhaHash, senha_temporaria: true, falhas_login: 0, bloqueado_ate: null, updated_at: trx.fn.now() })
        await trx('sessoes').where({ usuario_id: id }).whereNull('revogada_em').update({ revogada_em: trx.fn.now() })
      })
    },
    async indicadoresExistentes(ids) {
      if (!ids.length) return []
      return (await db('indicadores').whereIn('id', ids).select<{ id: number }[]>('id')).map((l) => l.id)
    },
    async definirIndicadores(usuarioId, ids) {
      await db.transaction(async (trx) => {
        await trx('cobrador_indicadores').where({ usuario_id: usuarioId }).delete()
        if (ids.length) await trx('cobrador_indicadores').insert(ids.map((indicador_id) => ({ usuario_id: usuarioId, indicador_id })))
      })
    },
    async definirAtivo(id, ativo) {
      await db.transaction(async (trx) => {
        await trx('users').where({ id }).update({ ativo, updated_at: trx.fn.now() })
        if (!ativo) await trx('sessoes').where({ usuario_id: id }).whereNull('revogada_em').update({ revogada_em: trx.fn.now() })
      })
    },
  }
}
