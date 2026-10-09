import type { Knex } from 'knex'
import { nomeEmprestimo, PAGO_PARCELA_EMPRESTIMO_SQL, PAGO_PARCELA_SQL } from '../../../shared/sql.js'
import { fazerAcordo, type ResultadoAcordo } from '../../acordos/models/acordo.js'
import { retomarVenda, type ResultadoRetomada } from '../../vendas/models/retomada.js'
import type { Alvo, Aprovacao, EscopoAprovacoes, OperacaoDoPedido, ParcelaDaOperacao, StatusAprovacao, TipoAprovacao } from './types.js'

export interface AprovacoesTx {
  /** Trava a venda/empréstimo: um desconto aprovado e um recebimento ao mesmo tempo não se atropelam. `carteira`: só se o cliente é dele. */
  travarOperacao(alvo: Alvo, id: number, carteira?: { usuarioId: number }): Promise<OperacaoDoPedido | null>
  parcela(alvo: Alvo, operacaoId: number, numero: number): Promise<ParcelaDaOperacao | null>
  parcelas(alvo: Alvo, operacaoId: number): Promise<ParcelaDaOperacao[]>
  criar(d: { alvo: Alvo; operacaoId: number; parcelaId: number; solicitadoPor: number; valor: number; motivo: string }): Promise<number>
  /** Pedido de retomada do aparelho de uma venda. */
  criarRetomada(d: { vendaId: number; solicitadoPor: number; valor: number; motivo: string }): Promise<number>
  /** Pedido de acordo (a proposta do cobrador vai em `dados`). */
  criarAcordo(d: { alvo: Alvo; operacaoId: number; solicitadoPor: number; valorTotal: number; motivo: string; parcelas: number; primeiraParcela: string; saldoNoPedido: number }): Promise<number>
  /** Faz o acordo (a operação já está travada nesta transação). */
  fazerAcordo(d: { alvo: Alvo; operacaoId: number; usuarioId: number; valorTotal: number; n: number; primeira: string; motivo: string | null; dia: string; aprovacaoId: number; saldoEsperado: number }): Promise<ResultadoAcordo>
  /** Retoma o aparelho (a venda já está travada nesta transação). */
  retomar(d: { vendaId: number; usuarioId: number; motivo: string | null; dia: string; excetoPedidoId: number }): Promise<ResultadoRetomada>
  /** Pedido travado até o fim da transação. */
  travarPedido(id: number): Promise<{ id: number; tipo: TipoAprovacao; status: StatusAprovacao; alvo: Alvo; operacaoId: number; parcelaId: number | null; valor: number; motivo: string | null; dados: { parcelas: number; primeiraParcela: string; saldoNoPedido: number } | null } | null>
  aplicarDesconto(alvo: Alvo, parcelaId: number, novoDesconto: number, quitadaEm: string | null): Promise<void>
  definirStatus(alvo: Alvo, id: number, status: 'ATIVA' | 'QUITADA'): Promise<void>
  responder(id: number, status: 'APROVADO' | 'RECUSADO', usuarioId: number, resposta: string | null): Promise<void>
}

export interface AprovacoesRepository {
  emTransacao<T>(fn: (tx: AprovacoesTx) => Promise<T>): Promise<T>
  listar(escopo: EscopoAprovacoes, f: { status?: StatusAprovacao; limite: number; offset: number }): Promise<{ itens: Aprovacao[]; total: number; pendentes: number }>
  buscar(id: number, escopo: EscopoAprovacoes): Promise<Aprovacao | null>
}

const dia = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)

/** Nomes de tabela e coluna de cada tipo de operação. */
const T = {
  VENDA: { op: 'vendas', parcela: 'venda_parcelas', opFk: 'venda_id', pedidoOp: 'venda_id', pedidoParcela: 'venda_parcela_id', pago: PAGO_PARCELA_SQL },
  EMPRESTIMO: { op: 'emprestimos', parcela: 'emprestimo_parcelas', opFk: 'emprestimo_id', pedidoOp: 'emprestimo_id', pedidoParcela: 'emprestimo_parcela_id', pago: PAGO_PARCELA_EMPRESTIMO_SQL },
} as const

type Linha = {
  id: number; tipo: TipoAprovacao; status: StatusAprovacao; venda_id: number | null; emprestimo_id: number | null; numero: number | null; n_parcelas: string; valor: string; motivo: string | null
  solicitado_por: number; solicitante: string; cliente_id: number; cliente_nome: string; modelo: string | null; modalidade: string | null; periodicidade: string | null; created_at: Date; dados: { parcelas: number; primeiraParcela: string; saldoNoPedido: number } | null
  respondente: string | null; respondido_em: Date | null; resposta: string | null
}
const paraAprovacao = (l: Linha): Aprovacao => ({
  id: l.id, tipo: l.tipo, status: l.status, alvo: l.venda_id !== null ? 'VENDA' : 'EMPRESTIMO', operacaoId: (l.venda_id ?? l.emprestimo_id)!, parcela: l.numero ?? null, nParcelas: Number(l.n_parcelas),
  valor: Number(l.valor), acordo: l.tipo === 'ACORDO' ? l.dados : null, motivo: l.motivo, solicitante: { id: l.solicitado_por, nome: l.solicitante }, cliente: { id: l.cliente_id, nome: l.cliente_nome },
  aparelho: l.venda_id !== null ? (l.modelo ?? '') : nomeEmprestimo(l.modalidade!, l.periodicidade!),
  criadaEm: l.created_at.toISOString(), respondidoPor: l.respondente, respondidoEm: l.respondido_em ? l.respondido_em.toISOString() : null, resposta: l.resposta,
})

export function createAprovacoesRepository(db: Knex): AprovacoesRepository {
  const base = (escopo: EscopoAprovacoes) => {
    const q = db('aprovacoes as a')
      .leftJoin('venda_parcelas as vp', 'vp.id', 'a.venda_parcela_id').leftJoin('emprestimo_parcelas as ep', 'ep.id', 'a.emprestimo_parcela_id')
      .leftJoin('vendas as v', 'v.id', 'a.venda_id').leftJoin('emprestimos as e', 'e.id', 'a.emprestimo_id').leftJoin('bens as b', 'b.id', 'v.bem_id')
      .join('clientes as c', 'c.id', db.raw('coalesce(v.cliente_id, e.cliente_id)'))
      .join('users as s', 's.id', 'a.solicitado_por').leftJoin('users as r', 'r.id', 'a.respondido_por')
    if (escopo.tipo === 'SOLICITANTE') q.where('a.solicitado_por', escopo.usuarioId)
    return q
  }
  const colunas = (q: Knex.QueryBuilder) => q.select<Linha[]>('a.id', 'a.tipo', 'a.status', 'a.venda_id', 'a.emprestimo_id', db.raw('coalesce(vp.numero, ep.numero) as numero'), 'a.valor', 'a.motivo', 'a.solicitado_por', 's.nome as solicitante',
    'c.id as cliente_id', 'c.nome as cliente_nome', 'b.modelo', 'e.modalidade', 'e.periodicidade', 'a.created_at', 'a.dados', 'r.nome as respondente', 'a.respondido_em', 'a.resposta',
    db.raw('case when a.venda_id is not null then (select count(*) from venda_parcelas x where x.venda_id = a.venda_id) else (select count(*) from emprestimo_parcelas x where x.emprestimo_id = a.emprestimo_id) end as n_parcelas'))

  return {
    async emTransacao(fn) {
      return db.transaction(async (trx) => {
        const tx: AprovacoesTx = {
          async travarOperacao(alvo, id, carteira) {
            const t = T[alvo]
            const q = trx(`${t.op} as o`).join('clientes as c', 'c.id', 'o.cliente_id').where('o.id', id).forUpdate('o')
            if (carteira) q.where('c.responsavel_id', carteira.usuarioId)
            const l = await q.first<{ id: number; cliente_id: number; status: OperacaoDoPedido['status'] } | undefined>('o.id', 'o.cliente_id', 'o.status')
            return l ? { id: l.id, alvo, clienteId: l.cliente_id, status: l.status } : null
          },
          async parcela(alvo, operacaoId, numero) {
            return (await tx.parcelas(alvo, operacaoId)).find((p) => p.numero === numero) ?? null
          },
          async parcelas(alvo, operacaoId) {
            const t = T[alvo]
            const ls = await trx(`${t.parcela} as p`).where(`p.${t.opFk}`, operacaoId).orderBy('p.numero')
              .select<{ id: number; numero: number; valor: string; desconto: string; vencimento: Date | string; pago: string }[]>('p.id', 'p.numero', 'p.valor', 'p.desconto', 'p.vencimento', trx.raw(`${t.pago} as pago`))
            return ls.map((l) => ({ id: l.id, numero: l.numero, valor: Number(l.valor), desconto: Number(l.desconto), pago: Number(l.pago), vencimento: dia(l.vencimento) }))
          },
          async criar(d) {
            const t = T[d.alvo]
            const [{ id }] = await trx('aprovacoes').insert({ tipo: 'DESCONTO', solicitado_por: d.solicitadoPor, [t.pedidoOp]: d.operacaoId, [t.pedidoParcela]: d.parcelaId, valor: d.valor, motivo: d.motivo }).returning('id')
            return id
          },
          async criarRetomada(d) {
            const [{ id }] = await trx('aprovacoes').insert({ tipo: 'RETOMADA', solicitado_por: d.solicitadoPor, venda_id: d.vendaId, valor: d.valor, motivo: d.motivo }).returning('id')
            return id
          },
          async criarAcordo(d) {
            const t = T[d.alvo]
            const [{ id }] = await trx('aprovacoes').insert({
              tipo: 'ACORDO', solicitado_por: d.solicitadoPor, [t.pedidoOp]: d.operacaoId, valor: d.valorTotal, motivo: d.motivo,
              dados: JSON.stringify({ parcelas: d.parcelas, primeiraParcela: d.primeiraParcela, saldoNoPedido: d.saldoNoPedido }),
            }).returning('id')
            return id
          },
          async fazerAcordo(d) { return fazerAcordo(trx, d) },
          async retomar(d) { return retomarVenda(trx, d) },
          async travarPedido(id) {
            const l = await trx('aprovacoes').where({ id }).forUpdate()
              .first<{ id: number; tipo: TipoAprovacao; status: StatusAprovacao; venda_id: number | null; emprestimo_id: number | null; venda_parcela_id: number | null; emprestimo_parcela_id: number | null; valor: string; motivo: string | null; dados: { parcelas: number; primeiraParcela: string; saldoNoPedido: number } | null } | undefined>('id', 'tipo', 'status', 'venda_id', 'emprestimo_id', 'venda_parcela_id', 'emprestimo_parcela_id', 'valor', 'motivo', 'dados')
            if (!l) return null
            const alvo: Alvo = l.venda_id !== null ? 'VENDA' : 'EMPRESTIMO'
            return { id: l.id, tipo: l.tipo, status: l.status, alvo, operacaoId: (l.venda_id ?? l.emprestimo_id)!, parcelaId: l.venda_parcela_id ?? l.emprestimo_parcela_id, valor: Number(l.valor), motivo: l.motivo, dados: l.dados }
          },
          async aplicarDesconto(alvo, parcelaId, novoDesconto, quitadaEm) {
            await trx(T[alvo].parcela).where({ id: parcelaId }).update({ desconto: novoDesconto, ...(quitadaEm ? { quitada_em: quitadaEm } : {}), updated_at: trx.fn.now() })
          },
          async definirStatus(alvo, id, status) {
            await trx(T[alvo].op).where({ id }).update({ status, updated_at: trx.fn.now() })
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
