import type { Knex } from 'knex'
import { PAGO_PARCELA_SQL } from '../../../shared/sql.js'
import type { Aprovacao, EscopoAprovacoes, ParcelaDaVenda, StatusAprovacao, VendaDoPedido } from './types.js'

export interface AprovacoesTx {
  /** Trava a venda: um desconto aprovado e um recebimento ao mesmo tempo não se atropelam. `carteira`: só se o cliente é dele. */
  travarVenda(id: number, carteira?: { usuarioId: number }): Promise<VendaDoPedido | null>
  parcela(vendaId: number, numero: number): Promise<ParcelaDaVenda | null>
  parcelas(vendaId: number): Promise<ParcelaDaVenda[]>
  criar(d: { vendaId: number; parcelaId: number; solicitadoPor: number; valor: number; motivo: string }): Promise<number>
  /** Pedido travado até o fim da transação. */
  travarPedido(id: number): Promise<{ id: number; status: StatusAprovacao; vendaId: number; parcelaId: number; valor: number } | null>
  aplicarDesconto(parcelaId: number, novoDesconto: number, quitadaEm: string | null): Promise<void>
  definirStatusVenda(id: number, status: 'ATIVA' | 'QUITADA'): Promise<void>
  responder(id: number, status: 'APROVADO' | 'RECUSADO', usuarioId: number, resposta: string | null): Promise<void>
}

export interface AprovacoesRepository {
  emTransacao<T>(fn: (tx: AprovacoesTx) => Promise<T>): Promise<T>
  listar(escopo: EscopoAprovacoes, f: { status?: StatusAprovacao; limite: number; offset: number }): Promise<{ itens: Aprovacao[]; total: number; pendentes: number }>
  buscar(id: number, escopo: EscopoAprovacoes): Promise<Aprovacao | null>
}

const dia = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)

type Linha = {
  id: number; tipo: 'DESCONTO'; status: StatusAprovacao; venda_id: number; numero: number; n_parcelas: string; valor: string; motivo: string | null
  solicitado_por: number; solicitante: string; cliente_id: number; cliente_nome: string; modelo: string; created_at: Date; respondente: string | null; respondido_em: Date | null; resposta: string | null
}
const paraAprovacao = (l: Linha): Aprovacao => ({
  id: l.id, tipo: l.tipo, status: l.status, vendaId: l.venda_id, parcela: l.numero, nParcelas: Number(l.n_parcelas), valor: Number(l.valor), motivo: l.motivo,
  solicitante: { id: l.solicitado_por, nome: l.solicitante }, cliente: { id: l.cliente_id, nome: l.cliente_nome }, aparelho: l.modelo,
  criadaEm: l.created_at.toISOString(), respondidoPor: l.respondente, respondidoEm: l.respondido_em ? l.respondido_em.toISOString() : null, resposta: l.resposta,
})

export function createAprovacoesRepository(db: Knex): AprovacoesRepository {
  const base = (escopo: EscopoAprovacoes) => {
    const q = db('aprovacoes as a')
      .join('venda_parcelas as p', 'p.id', 'a.venda_parcela_id').join('vendas as v', 'v.id', 'a.venda_id').join('clientes as c', 'c.id', 'v.cliente_id').join('bens as b', 'b.id', 'v.bem_id')
      .join('users as s', 's.id', 'a.solicitado_por').leftJoin('users as r', 'r.id', 'a.respondido_por').where('a.tipo', 'DESCONTO')
    if (escopo.tipo === 'SOLICITANTE') q.where('a.solicitado_por', escopo.usuarioId)
    return q
  }
  const colunas = (q: Knex.QueryBuilder) => q.select<Linha[]>('a.id', 'a.tipo', 'a.status', 'a.venda_id', 'p.numero', 'a.valor', 'a.motivo', 'a.solicitado_por', 's.nome as solicitante', 'c.id as cliente_id', 'c.nome as cliente_nome', 'b.modelo',
    'a.created_at', 'r.nome as respondente', 'a.respondido_em', 'a.resposta', db.raw('(select count(*) from venda_parcelas x where x.venda_id = a.venda_id) as n_parcelas'))

  return {
    async emTransacao(fn) {
      return db.transaction(async (trx) => {
        const tx: AprovacoesTx = {
          async travarVenda(id, carteira) {
            const q = trx('vendas as v').join('clientes as c', 'c.id', 'v.cliente_id').where('v.id', id).forUpdate('v')
            if (carteira) q.where('c.responsavel_id', carteira.usuarioId)
            const l = await q.first<{ id: number; cliente_id: number; status: VendaDoPedido['status'] } | undefined>('v.id', 'v.cliente_id', 'v.status')
            return l ? { id: l.id, clienteId: l.cliente_id, status: l.status } : null
          },
          async parcela(vendaId, numero) {
            return (await tx.parcelas(vendaId)).find((p) => p.numero === numero) ?? null
          },
          async parcelas(vendaId) {
            const ls = await trx('venda_parcelas as p').where('p.venda_id', vendaId).orderBy('p.numero')
              .select<{ id: number; numero: number; valor: string; desconto: string; vencimento: Date | string; pago: string }[]>('p.id', 'p.numero', 'p.valor', 'p.desconto', 'p.vencimento', trx.raw(`${PAGO_PARCELA_SQL} as pago`))
            return ls.map((l) => ({ id: l.id, numero: l.numero, valor: Number(l.valor), desconto: Number(l.desconto), pago: Number(l.pago), vencimento: dia(l.vencimento) }))
          },
          async criar(d) {
            const [{ id }] = await trx('aprovacoes').insert({ tipo: 'DESCONTO', solicitado_por: d.solicitadoPor, venda_id: d.vendaId, venda_parcela_id: d.parcelaId, valor: d.valor, motivo: d.motivo }).returning('id')
            return id
          },
          async travarPedido(id) {
            const l = await trx('aprovacoes').where({ id, tipo: 'DESCONTO' }).forUpdate().first<{ id: number; status: StatusAprovacao; venda_id: number; venda_parcela_id: number; valor: string } | undefined>('id', 'status', 'venda_id', 'venda_parcela_id', 'valor')
            return l ? { id: l.id, status: l.status, vendaId: l.venda_id, parcelaId: l.venda_parcela_id, valor: Number(l.valor) } : null
          },
          async aplicarDesconto(parcelaId, novoDesconto, quitadaEm) {
            await trx('venda_parcelas').where({ id: parcelaId }).update({ desconto: novoDesconto, ...(quitadaEm ? { quitada_em: quitadaEm } : {}), updated_at: trx.fn.now() })
          },
          async definirStatusVenda(id, status) {
            await trx('vendas').where({ id }).update({ status, updated_at: trx.fn.now() })
          },
          async responder(id, status, usuarioId, resposta) {
            await trx('aprovacoes').where({ id }).update({ status, respondido_por: usuarioId, respondido_em: trx.fn.now(), resposta, updated_at: trx.fn.now() })
          },
        }
        return fn(tx)
      })
    },

    async listar(escopo, f) {
      const filtrar = (q: Knex.QueryBuilder) => { if (f.status) q.where('a.status', f.status); return q }
      const [{ n }] = await filtrar(base(escopo)).count<{ n: string }[]>({ n: '*' })
      const [{ n: pend }] = await base(escopo).where('a.status', 'PENDENTE').count<{ n: string }[]>({ n: '*' })
      // pendentes primeiro (os mais antigos no topo); depois os respondidos, do mais recente para o mais antigo
      const ls = await colunas(filtrar(base(escopo))).orderByRaw("(a.status = 'PENDENTE') desc, case when a.status = 'PENDENTE' then a.created_at end asc, a.respondido_em desc nulls last, a.id desc").limit(f.limite).offset(f.offset)
      return { itens: ls.map(paraAprovacao), total: Number(n), pendentes: Number(pend) }
    },
    async buscar(id, escopo) {
      const l = await colunas(base(escopo).where('a.id', id)).first()
      return l ? paraAprovacao(l) : null
    },
  }
}
