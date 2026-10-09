import type { Knex } from 'knex'
import { naoEncontrado } from '../../../shared/errors.js'
import { retomarVenda, type ResultadoRetomada } from './retomada.js'
import type { AparelhoTravado, EscopoVendas, FormaPagamento, NovaTroca, NovaVenda, ParcelaVenda, Venda } from './types.js'

/** Operações que precisam acontecer juntas, na mesma transação do banco. */
export interface VendasTx {
  /** Trava a linha do aparelho até o fim da transação: duas vendas do mesmo aparelho não passam juntas. */
  travarAparelho(id: number): Promise<AparelhoTravado | null>
  clienteNoEscopo(id: number, escopo: EscopoVendas): Promise<{ id: number; nome: string } | null>
  indicadorAtivo(id: number): Promise<{ id: number; nome: string; pct: number } | null>
  vendedorValido(id: number): Promise<boolean>
  criarAparelhoTroca(d: NovaTroca): Promise<number>
  criarVenda(d: NovaVenda): Promise<number>
  criarParcelas(vendaId: number, itens: { numero: number; vencimento: string; valor: number }[]): Promise<void>
  registrarEntrada(d: { vendaId: number; clienteId: number; valor: number; forma: FormaPagamento; data: string; recebidoPor: number; resumo: object }): Promise<void>
  marcarVendido(bemId: number): Promise<void>
}

export interface VendasRepository {
  emTransacao<T>(fn: (tx: VendasTx) => Promise<T>): Promise<T>
  /** Todas as vendas do escopo (com parcelas e quanto já foi pago), da mais nova para a mais antiga. */
  listar(escopo: EscopoVendas): Promise<Venda[]>
  buscar(id: number, escopo: EscopoVendas): Promise<Venda | null>
  /** Retoma o aparelho (venda travada, regra única em `retomarVenda`). */
  retomar(d: { vendaId: number; usuarioId: number; motivo: string | null; dia: string }): Promise<ResultadoRetomada>
}

type LinhaVenda = {
  id: number; bem_id: number; modelo: string; gb: number; cor: string; cliente_id: number; cliente_nome: string; vendedor_id: number | null
  indicador_id: number | null; indicador_nome: string | null; percentual_indicador: string; data_venda: Date | string; preco_acordado: string
  entrada: string; troca_valor: string; juros_pct: string; valor_investido: string; status: Venda['status']; contrato_status: Venda['contrato']; retomada_em: Date | null; retomada_motivo: string | null
}
type LinhaParcela = { id: number; venda_id: number; numero: number; vencimento: Date | string; vencimento_original: Date | string | null; valor: string; desconto: string; quitada_em: Date | string | null; pago: string; acordo_id: number | null; encerrada_acordo_id: number | null }

const dia = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)
const diaOuNull = (d: Date | string | null) => (d === null ? null : dia(d))

export function createVendasRepository(db: Knex): VendasRepository {
  function consulta(escopo: EscopoVendas) {
    const q = db('vendas as v')
      .join('bens as b', 'b.id', 'v.bem_id')
      .join('clientes as c', 'c.id', 'v.cliente_id')
      .leftJoin('indicadores as i', 'i.id', 'v.indicador_id')
      .select<LinhaVenda[]>('v.*', 'b.modelo', 'b.gb', 'b.cor', 'c.nome as cliente_nome', 'i.nome as indicador_nome')
    if (escopo.tipo === 'VENDEDOR') q.where((w) => w.where('v.vendedor_id', escopo.usuarioId).orWhere('c.responsavel_id', escopo.usuarioId))
    else if (escopo.tipo === 'CARTEIRA') q.where('c.responsavel_id', escopo.usuarioId)
    else if (escopo.tipo === 'INDICADOR') q.where('v.indicador_id', escopo.indicadorId)
    return q
  }

  async function montar(linhas: LinhaVenda[]): Promise<Venda[]> {
    if (!linhas.length) return []
    const ps = await db('venda_parcelas as p')
      .whereIn('p.venda_id', linhas.map((l) => l.id))
      .select<LinhaParcela[]>(
        'p.*',
        // o que já entrou na parcela: recebimentos de transações que não foram desfeitas
        db.raw(`coalesce((select sum(r.valor) from recebimentos r join transacoes_recebimento t on t.id = r.transacao_id
                 where r.venda_parcela_id = p.id and t.desfeita_em is null), 0) as pago`),
      )
      .orderBy(['p.venda_id', 'p.numero'])
    const porVenda = new Map<number, ParcelaVenda[]>()
    for (const p of ps) {
      const lista = porVenda.get(p.venda_id) ?? []
      lista.push({ id: p.id, numero: p.numero, vencimento: dia(p.vencimento), vencimentoOriginal: diaOuNull(p.vencimento_original), valor: Number(p.valor), desconto: Number(p.desconto), quitadaEm: diaOuNull(p.quitada_em), pago: Number(p.pago), acordo: p.encerrada_acordo_id ? 'ENCERRADA' : p.acordo_id ? 'NOVA' : null })
      porVenda.set(p.venda_id, lista)
    }
    return linhas.map((l) => ({
      id: l.id, aparelho: { id: l.bem_id, modelo: l.modelo, gb: l.gb, cor: l.cor }, cliente: { id: l.cliente_id, nome: l.cliente_nome },
      vendedorId: l.vendedor_id, indicador: l.indicador_id ? { id: l.indicador_id, nome: l.indicador_nome ?? '' } : null,
      pct: Number(l.percentual_indicador), dataVenda: dia(l.data_venda), precoAcordado: Number(l.preco_acordado), entrada: Number(l.entrada),
      troca: Number(l.troca_valor), jurosPct: Number(l.juros_pct), investido: Number(l.valor_investido), status: l.status, contrato: l.contrato_status,
      retomada: l.retomada_em ? { em: l.retomada_em.toISOString(), motivo: l.retomada_motivo } : null,
      parcelas: porVenda.get(l.id) ?? [],
    }))
  }

  return {
    async listar(escopo) {
      return montar(await consulta(escopo).orderBy([{ column: 'v.data_venda', order: 'desc' }, { column: 'v.id', order: 'desc' }]))
    },
    async buscar(id, escopo) {
      const l = await consulta(escopo).where('v.id', id).first()
      return l ? (await montar([l]))[0] : null
    },

    async retomar(d) {
      return db.transaction(async (trx) => {
        if (!(await trx('vendas').where({ id: d.vendaId }).forUpdate().first('id'))) throw naoEncontrado('Venda não encontrada')
        return retomarVenda(trx, d)
      })
    },

    async emTransacao(fn) {
      return db.transaction(async (trx) => {
        const tx: VendasTx = {
          async travarAparelho(id) {
            const l = await trx('bens').where({ id }).forUpdate().first()
            if (!l) return null
            return { id: l.id, modelo: l.modelo, gb: l.gb, cor: l.cor, estado: l.estado, custo: Number(l.valor_compra), extras: Number(l.custos_extras), preco: Number(l.preco_venda), clienteEncomendaId: l.cliente_encomenda_id }
          },
          async clienteNoEscopo(id, escopo) {
            const q = trx('clientes').where({ id })
            if (escopo.tipo === 'INDICADOR') q.whereRaw('false') // o indicador não vende
            else if (escopo.tipo !== 'TODOS') q.where({ responsavel_id: escopo.usuarioId })
            return (await q.first<{ id: number; nome: string } | undefined>('id', 'nome')) ?? null
          },
          async indicadorAtivo(id) {
            const l = await trx('indicadores').where({ id, ativo: true }).first<{ id: number; nome: string; pct: string } | undefined>('id', 'nome', 'pct')
            return l ? { id: l.id, nome: l.nome, pct: Number(l.pct) } : null
          },
          async vendedorValido(id) {
            return !!(await trx('users').where({ id, ativo: true }).whereIn('perfil', ['ADMIN', 'VENDEDOR']).first('id'))
          },
          async criarAparelhoTroca(d) {
            const [{ id }] = await trx('bens').insert({
              modelo: d.modelo, gb: d.gb, cor: d.cor, bateria: d.bateria, condicao: 'Seminovo', imei: d.imei, valor_compra: d.custo, custos_extras: 0,
              preco_venda: d.preco, estado: 'DISPONIVEL', origem: 'TROCA', data_compra: d.dataCompra,
            }).returning('id')
            return id
          },
          async criarVenda(d) {
            const [{ id }] = await trx('vendas').insert({
              bem_id: d.bemId, cliente_id: d.clienteId, vendedor_id: d.vendedorId, indicador_id: d.indicadorId, percentual_indicador: d.pct, data_venda: d.dataVenda,
              preco_acordado: d.precoAcordado, entrada: d.entrada, troca_valor: d.troca, troca_bem_id: d.trocaBemId, juros_pct: d.jurosPct,
              valor_investido: d.investido, valor_total: d.total, status: d.status,
            }).returning('id')
            return id
          },
          async criarParcelas(vendaId, itens) {
            if (itens.length) await trx('venda_parcelas').insert(itens.map((p) => ({ venda_id: vendaId, numero: p.numero, vencimento: p.vencimento, valor: p.valor })))
          },
          async registrarEntrada(d) {
            const [{ n }] = (await trx.raw("select nextval('recibo_numero_seq') as n")).rows
            const [{ id: transacaoId }] = await trx('transacoes_recebimento').insert({
              numero_recibo: Number(n), cliente_id: d.clienteId, valor_total: d.valor, forma_pagamento: d.forma, data_recebimento: d.data, recebido_por: d.recebidoPor, resumo: JSON.stringify(d.resumo),
            }).returning('id')
            await trx('recebimentos').insert({ transacao_id: transacaoId, tipo: 'ENTRADA', venda_id: d.vendaId, valor: d.valor })
          },
          async marcarVendido(bemId) {
            await trx('bens').where({ id: bemId }).update({ estado: 'VENDIDO', cliente_encomenda_id: null, updated_at: trx.fn.now() })
          },
        }
        return fn(tx)
      })
    },
  }
}
