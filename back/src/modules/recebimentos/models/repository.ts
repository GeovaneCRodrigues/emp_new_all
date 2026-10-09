import type { Knex } from 'knex'
import { addDia } from '../../../shared/datas.js'
import { NOME_EMPRESTIMO_SQL, nomeEmprestimo } from '../../../shared/sql.js'
import type { Alvo, AjustesTransacao, Aba, EscopoRecebimentos, EstadoParcela, FormaPagamento, LinhaCobranca, OperacaoTravada, PagamentoDaOperacao, ParcelaAberta, RecebimentoDaTransacao, ReciboRegistro, ResultadoCobrancas, ResumoRecibo, TransacaoRegistro } from './types.js'

/** Operações que precisam acontecer juntas, na mesma transação do banco. */
export interface RecebimentosTx {
  /** Trava a venda/empréstimo até o fim da transação: dois recebimentos da mesma operação não se atropelam. */
  travarOperacao(alvo: Alvo, id: number, escopo: EscopoRecebimentos): Promise<OperacaoTravada | null>
  parcelas(alvo: Alvo, operacaoId: number): Promise<ParcelaAberta[]>
  atualizarParcela(alvo: Alvo, id: number, e: EstadoParcela): Promise<void>
  criarTransacao(d: { clienteId: number; valorTotal: number; forma: FormaPagamento; data: string; recebidoPor: number; resumo: ResumoRecibo; ajustes?: AjustesTransacao | null }): Promise<{ id: number; numeroRecibo: number }>
  criarRecebimento(alvo: Alvo, d: { transacaoId: number; parcelaId: number; valor: number; antes: EstadoParcela }): Promise<void>
  definirStatus(alvo: Alvo, id: number, status: 'ATIVA' | 'QUITADA'): Promise<void>
  /** Só juros: o capital emprestado menos o que já foi amortizado (recebimentos não desfeitos). */
  capitalAberto(emprestimoId: number): Promise<number>
  // desfazer
  travarTransacao(id: number): Promise<TransacaoRegistro | null>
  recebimentosDaTransacao(alvo: Alvo, transacaoId: number): Promise<RecebimentoDaTransacao[]>
  /** É a transação de parcelas mais recente (não desfeita) desta operação? */
  ehUltimaDaOperacao(alvo: Alvo, operacaoId: number, transacaoId: number): Promise<boolean>
  marcarDesfeita(id: number, usuarioId: number): Promise<void>
  /** Serializa o caixa de um cobrador: receber, desfazer e fechar o dia nunca se atropelam. */
  travarCaixa(usuarioId: number): Promise<void>
  /** O dia dessa pessoa já foi fechado? */
  diaFechado(usuarioId: number, data: string): Promise<boolean>
  pedidoPendente(alvo: Alvo, parcelaId: number): Promise<boolean>
  criarPedidoDesconto(alvo: Alvo, d: { operacaoId: number; parcelaId: number; solicitadoPor: number; valor: number; motivo: string }): Promise<number>
}

export interface RecebimentosRepository {
  emTransacao<T>(fn: (tx: RecebimentosTx) => Promise<T>): Promise<T>
  /** A venda/empréstimo que a transação paga (pelas parcelas), antes de abrir a transação de desfazer. */
  operacaoDaTransacao(transacaoId: number): Promise<{ alvo: Alvo; id: number } | null>
  buscarRecibo(id: number): Promise<ReciboRegistro | null>
  /** Operação dentro do escopo (fora dele é como se não existisse). */
  operacaoNoEscopo(alvo: Alvo, id: number, escopo: EscopoRecebimentos): Promise<{ id: number } | null>
  pagamentosDaOperacao(alvo: Alvo, id: number): Promise<PagamentoDaOperacao[]>
  cobrancas(escopo: EscopoRecebimentos, f: { aba: Aba; tipo?: Alvo; busca?: string; hoje: string; limite: number; offset: number }): Promise<ResultadoCobrancas>
  empresa(): Promise<{ nome: string; cnpj: string | null }>
}

const dia = (d: Date | string | null) => (d === null ? null : (typeof d === 'string' ? d : d.toISOString()).slice(0, 10))

type LinhaTransacao = { eh_entrada?: boolean; id: number; numero_recibo: number; cliente_id: number; valor_total: string; forma_pagamento: FormaPagamento; data_recebimento: Date | string; recebido_por: number | null; recebido_por_nome: string | null; desfeita_em: Date | null; resumo: ResumoRecibo | null; ajustes: AjustesTransacao | null }
const paraTransacao = (l: LinhaTransacao): TransacaoRegistro => ({
  id: l.id, numeroRecibo: l.numero_recibo, clienteId: l.cliente_id, valorTotal: Number(l.valor_total), forma: l.forma_pagamento, data: dia(l.data_recebimento)!,
  recebidoPor: l.recebido_por, recebidoPorNome: l.recebido_por_nome, desfeita: l.desfeita_em !== null, resumo: l.resumo, ajustes: l.ajustes ?? null,
})

/** Nomes de tabela e coluna de cada tipo de operação. */
const T = {
  VENDA: { op: 'vendas', parcela: 'venda_parcelas', fk: 'venda_parcela_id', opFk: 'venda_id', dataCol: 'data_venda' },
  EMPRESTIMO: { op: 'emprestimos', parcela: 'emprestimo_parcelas', fk: 'emprestimo_parcela_id', opFk: 'emprestimo_id', dataCol: 'data_emprestimo' },
} as const

/** Quanto já entrou na parcela `p`: recebimentos de transações que não foram desfeitas. */
const pagoSql = (alvo: Alvo) => `coalesce((select sum(r.valor) from recebimentos r join transacoes_recebimento t on t.id = r.transacao_id where r.${T[alvo].fk} = p.id and t.desfeita_em is null), 0)`

export function createRecebimentosRepository(db: Knex): RecebimentosRepository {
  // o indicador só LÊ (a lista de cobranças das operações dele); os registros de dinheiro continuam só do admin e do cobrador
  const escopoSql = (q: Knex.QueryBuilder, e: EscopoRecebimentos) => {
    if (e.tipo === 'CARTEIRA') q.where('c.responsavel_id', e.usuarioId)
    else if (e.tipo === 'INDICADOR') q.where('o.indicador_id', e.indicadorId)
    return q
  }

  return {
    async emTransacao(fn) {
      return db.transaction(async (trx) => {
        const tx: RecebimentosTx = {
          async travarOperacao(alvo, id, escopo) {
            const t = T[alvo]
            // trava só a linha da operação (FOR UPDATE OF o); o resto é leitura
            const q = trx(`${t.op} as o`).join('clientes as c', 'c.id', 'o.cliente_id').where('o.id', id).forUpdate('o')
            escopoSql(q, escopo)
            if (alvo === 'VENDA') q.join('bens as b', 'b.id', 'o.bem_id')
            const cols = ['o.id', 'o.cliente_id', 'o.status', `o.${t.dataCol} as data`, 'c.nome as nome', 'c.fone as fone', trx.raw(`(select count(*) from ${t.parcela} x where x.${t.opFk} = o.id) as n`)]
            const l = await q.first<{ id: number; cliente_id: number; status: OperacaoTravada['status']; data: Date | string; nome: string; fone: string; n: string; modelo?: string; modalidade?: OperacaoTravada['modalidade'] & string; periodicidade?: string; taxa?: string } | undefined>(
              ...cols, ...(alvo === 'VENDA' ? ['b.modelo as modelo'] : ['o.modalidade as modalidade', 'o.periodicidade as periodicidade', 'o.taxa as taxa']),
            )
            if (!l) return null
            return {
              id: l.id, alvo, clienteId: l.cliente_id, clienteNome: l.nome, clienteFone: l.fone, status: l.status, data: dia(l.data)!, nParcelas: Number(l.n),
              descricao: alvo === 'VENDA' ? l.modelo! : nomeEmprestimo(l.modalidade!, l.periodicidade!), modalidade: alvo === 'EMPRESTIMO' ? l.modalidade! : null, taxa: alvo === 'EMPRESTIMO' ? Number(l.taxa) : null,
              temAcordo: !!(await trx('acordos').where({ [t.opFk]: id, status: 'ATIVO' }).first('id')),
            }
          },
          async parcelas(alvo, operacaoId) {
            const t = T[alvo]
            const ls = await trx(`${t.parcela} as p`).where(`p.${t.opFk}`, operacaoId).orderBy('p.numero').select<{ id: number; numero: number; vencimento: Date | string; vencimento_original: Date | string | null; valor: string; desconto: string; quitada_em: Date | string | null; pago: string }[]>('p.*', trx.raw(`${pagoSql(alvo)} as pago`))
            return ls.map((l) => ({ id: l.id, numero: l.numero, vencimento: dia(l.vencimento)!, vencimentoOriginal: dia(l.vencimento_original), valor: Number(l.valor), desconto: Number(l.desconto), pago: Number(l.pago), quitadaEm: dia(l.quitada_em) }))
          },
          async atualizarParcela(alvo, id, e) {
            await trx(T[alvo].parcela).where({ id }).update({ vencimento: e.vencimento, vencimento_original: e.vencimentoOriginal, desconto: e.desconto, quitada_em: e.quitadaEm, ...(e.valor !== undefined ? { valor: e.valor } : {}), updated_at: trx.fn.now() })
          },
          async criarTransacao(d) {
            const [{ n }] = (await trx.raw("select nextval('recibo_numero_seq') as n")).rows
            const [{ id }] = await trx('transacoes_recebimento').insert({
              numero_recibo: Number(n), cliente_id: d.clienteId, valor_total: d.valorTotal, forma_pagamento: d.forma, data_recebimento: d.data, recebido_por: d.recebidoPor,
              resumo: JSON.stringify(d.resumo), ajustes: d.ajustes ? JSON.stringify(d.ajustes) : null,
            }).returning('id')
            return { id, numeroRecibo: Number(n) }
          },
          async criarRecebimento(alvo, d) {
            await trx('recebimentos').insert({ transacao_id: d.transacaoId, tipo: 'PARCELA', [T[alvo].fk]: d.parcelaId, valor: d.valor, antes: JSON.stringify(d.antes) })
          },
          async definirStatus(alvo, id, status) {
            await trx(T[alvo].op).where({ id }).update({ status, updated_at: trx.fn.now() })
          },
          async capitalAberto(emprestimoId) {
            const e = await trx('emprestimos').where({ id: emprestimoId }).first<{ capital: string }>('capital')
            const r = await trx('transacoes_recebimento as t').whereNull('t.desfeita_em').whereNotNull('t.ajustes')
              .whereIn('t.id', trx('recebimentos as r').join('emprestimo_parcelas as p', 'p.id', 'r.emprestimo_parcela_id').where('p.emprestimo_id', emprestimoId).select('r.transacao_id'))
              .sum<{ soma: string | null }>({ soma: trx.raw("(t.ajustes->>'amortizacao')::numeric") }).first()
            return Math.round((Number(e.capital) - Number(r?.soma ?? 0)) * 100) / 100
          },
          async travarTransacao(id) {
            const l = await trx('transacoes_recebimento as t').leftJoin('users as u', 'u.id', 't.recebido_por').where('t.id', id).forUpdate('t')
              .first<LinhaTransacao | undefined>('t.*', 'u.nome as recebido_por_nome')
            return l ? paraTransacao(l) : null
          },
          async recebimentosDaTransacao(alvo, transacaoId) {
            const t = T[alvo]
            const ls = await trx('recebimentos as r').join(`${t.parcela} as p`, 'p.id', `r.${t.fk}`).where('r.transacao_id', transacaoId).orderBy('p.numero')
              .select<{ id: number; parcela_id: number; numero: number; operacao_id: number; valor: string; antes: EstadoParcela | null; encerrada: number | null }[]>('r.id', `r.${t.fk} as parcela_id`, 'p.numero', `p.${t.opFk} as operacao_id`, 'r.valor', 'r.antes', 'p.encerrada_acordo_id as encerrada')
            return ls.map((l) => ({ id: l.id, parcelaId: l.parcela_id, numero: l.numero, operacaoId: l.operacao_id, valor: Number(l.valor), antes: l.antes, encerradaPorAcordo: l.encerrada !== null }))
          },
          async ehUltimaDaOperacao(alvo, operacaoId, transacaoId) {
            const t = T[alvo]
            const r = await trx('transacoes_recebimento as t').join('recebimentos as r', 'r.transacao_id', 't.id').join(`${t.parcela} as p`, 'p.id', `r.${t.fk}`)
              .where(`p.${t.opFk}`, operacaoId).whereNull('t.desfeita_em').max<{ max: number | null }>('t.id as max').first()
            return r?.max === transacaoId
          },
          async travarCaixa(usuarioId) { await trx.raw('select pg_advisory_xact_lock(?, ?)', [7001, usuarioId]) },
          async diaFechado(usuarioId, data) { return !!(await trx('fechamentos_caixa').where({ usuario_id: usuarioId, data }).first('id')) },
          async pedidoPendente(alvo, parcelaId) { return !!(await trx('aprovacoes').where({ [T[alvo].fk]: parcelaId, status: 'PENDENTE', tipo: 'DESCONTO' }).first('id')) },
          async criarPedidoDesconto(alvo, d) {
            const [{ id }] = await trx('aprovacoes').insert({ tipo: 'DESCONTO', solicitado_por: d.solicitadoPor, [T[alvo].opFk]: d.operacaoId, [T[alvo].fk]: d.parcelaId, valor: d.valor, motivo: d.motivo }).returning('id')
            return id
          },
          async marcarDesfeita(id, usuarioId) {
            await trx('transacoes_recebimento').where({ id }).update({ desfeita_em: trx.fn.now(), desfeita_por: usuarioId, updated_at: trx.fn.now() })
          },
        }
        return fn(tx)
      })
    },

    async operacaoDaTransacao(transacaoId) {
      const r = await db('recebimentos as r').leftJoin('venda_parcelas as vp', 'vp.id', 'r.venda_parcela_id').leftJoin('emprestimo_parcelas as ep', 'ep.id', 'r.emprestimo_parcela_id')
        .where('r.transacao_id', transacaoId).whereNot('r.tipo', 'ENTRADA').first<{ venda_id: number | null; emprestimo_id: number | null } | undefined>('vp.venda_id', 'ep.emprestimo_id')
      if (!r) return null
      return r.venda_id !== null ? { alvo: 'VENDA', id: r.venda_id } : r.emprestimo_id !== null ? { alvo: 'EMPRESTIMO', id: r.emprestimo_id } : null
    },

    async buscarRecibo(id) {
      const l = await db('transacoes_recebimento as t').join('clientes as c', 'c.id', 't.cliente_id').leftJoin('users as u', 'u.id', 't.recebido_por').where('t.id', id)
        .first<(LinhaTransacao & { cliente_nome: string; cliente_fone: string; responsavel_id: number | null }) | undefined>('t.*', 'u.nome as recebido_por_nome', 'c.nome as cliente_nome', 'c.fone as cliente_fone', 'c.responsavel_id', db.raw("exists (select 1 from recebimentos r where r.transacao_id = t.id and r.tipo = 'ENTRADA') as eh_entrada"))
      if (!l) return null
      // a operação: venda (pela entrada ou pelas parcelas) ou empréstimo (pelas parcelas)
      const v = await db('recebimentos as r').leftJoin('venda_parcelas as vp', 'vp.id', 'r.venda_parcela_id').leftJoin('emprestimo_parcelas as ep', 'ep.id', 'r.emprestimo_parcela_id')
        .leftJoin('vendas as v', 'v.id', db.raw('coalesce(r.venda_id, vp.venda_id)')).leftJoin('bens as b', 'b.id', 'v.bem_id').leftJoin('emprestimos as e', 'e.id', 'ep.emprestimo_id')
        .where('r.transacao_id', id).first<{ venda_id: number | null; modelo: string | null; emprestimo_id: number | null; modalidade: string | null; periodicidade: string | null } | undefined>('v.id as venda_id', 'b.modelo', 'e.id as emprestimo_id', 'e.modalidade', 'e.periodicidade')
      const alvo: Alvo | null = v?.venda_id ? 'VENDA' : v?.emprestimo_id ? 'EMPRESTIMO' : null
      return {
        ...paraTransacao(l), tipo: l.eh_entrada ? ('ENTRADA' as const) : ('PARCELA' as const), alvo, operacaoId: v?.venda_id ?? v?.emprestimo_id ?? null,
        clienteNome: l.cliente_nome, clienteFone: l.cliente_fone, descricao: alvo === 'EMPRESTIMO' ? nomeEmprestimo(v!.modalidade!, v!.periodicidade!) : (v?.modelo ?? ''), responsavelId: l.responsavel_id,
      }
    },

    async operacaoNoEscopo(alvo, id, escopo) {
      const q = db(`${T[alvo].op} as o`).join('clientes as c', 'c.id', 'o.cliente_id').where('o.id', id)
      escopoSql(q, escopo)
      return (await q.first<{ id: number } | undefined>('o.id')) ?? null
    },

    async pagamentosDaOperacao(alvo, id) {
      const t = T[alvo]
      const transacoes = db('recebimentos as r').leftJoin(`${t.parcela} as p`, 'p.id', `r.${t.fk}`)
        .where(alvo === 'VENDA' ? db.raw('coalesce(r.venda_id, p.venda_id) = ?', [id]) : db.raw('p.emprestimo_id = ?', [id])).select('r.transacao_id')
      const ls = await db('transacoes_recebimento as t').leftJoin('users as u', 'u.id', 't.recebido_por').whereIn('t.id', transacoes)
        .orderBy('t.id', 'desc').select<LinhaTransacao[]>('t.*', 'u.nome as recebido_por_nome', db.raw("exists (select 1 from recebimentos r where r.transacao_id = t.id and r.tipo = 'ENTRADA') as eh_entrada"))
      // entrada ou parcela vem do tipo real do recebimento, não do retrato (que pode faltar em dados antigos)
      return ls.map((l) => ({ ...paraTransacao(l), tipo: l.eh_entrada ? ('ENTRADA' as const) : ('PARCELA' as const) }))
    },

    async cobrancas(escopo, f) {
      // uma consulta por tipo de operação, com as mesmas colunas; depois as duas são unidas
      const linhas = (alvo: Alvo) => {
        const t = T[alvo]
        const q = db(`${t.parcela} as p`).join(`${t.op} as o`, 'o.id', `p.${t.opFk}`).join('clientes as c', 'c.id', 'o.cliente_id')
        if (alvo === 'VENDA') q.join('bens as b', 'b.id', 'o.bem_id').whereNotIn('o.status', ['RETOMADA', 'CANCELADA'])
        else q.whereNot('o.status', 'CANCELADA')
        escopoSql(q, escopo)
        return q.select(
          db.raw('? as tipo', [alvo]), 'o.id as operacao_id', 'p.numero', 'p.vencimento', 'p.vencimento_original', 'p.valor', 'p.desconto', 'c.id as cliente_id', 'c.nome as cliente_nome', 'c.fone as cliente_fone',
          db.raw(alvo === 'VENDA' ? 'b.modelo as descricao' : `${NOME_EMPRESTIMO_SQL.replace(/\be\./g, 'o.')} as descricao`),
          db.raw(`(select count(*) from ${t.parcela} x where x.${t.opFk} = o.id) as n_parcelas`),
          db.raw(`${pagoSql(alvo)} as pago`),
          db.raw(`(p.valor - ${pagoSql(alvo)} - p.desconto) as falta`),
          db.raw(`(select max(t.id) from recebimentos r join transacoes_recebimento t on t.id = r.transacao_id where r.${t.fk} = p.id and t.desfeita_em is null) as ultima`),
          db.raw(`(select max(t.data_recebimento) from recebimentos r join transacoes_recebimento t on t.id = r.transacao_id where r.${t.fk} = p.id and t.desfeita_em is null) as ultima_data`),
        )
      }
      const tipos: Alvo[] = f.tipo ? [f.tipo] : ['VENDA', 'EMPRESTIMO']
      const h = f.hoje, mais7 = addDia(h, 7), mais8 = addDia(h, 8), mais45 = addDia(h, 45), menos30 = addDia(h, -30)
      const filtroAba = (q: Knex.QueryBuilder) => {
        // busca pelo nome do cliente, sem acento e sem maiúscula (a busca já chega normalizada)
        if (f.busca) q.whereRaw("translate(lower(u.cliente_nome), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like ? escape '\\'", [`%${f.busca.replace(/[\\%_]/g, '\\$&')}%`])
        if (f.aba === 'atrasadas') q.whereRaw('u.falta > 0.009 and u.vencimento < ?', [h])
        else if (f.aba === 'hoje') q.whereRaw('u.falta > 0.009 and u.vencimento between ? and ?', [h, mais7])
        else if (f.aba === 'proximas') q.whereRaw('u.falta > 0.009 and u.vencimento between ? and ?', [mais8, mais45])
        else q.whereRaw('u.ultima_data >= ?', [menos30])
        return q
      }
      const fonte = () => db.from(db.raw('(' + tipos.map((a) => `(${linhas(a).toQuery()})`).join(' union all ') + ') as u'))
      const [soma] = await filtroAba(fonte()).select<{ n: string; total: string }[]>(db.raw('count(*) as n'), db.raw(f.aba === 'recebidas' ? 'coalesce(sum(u.pago), 0) as total' : 'coalesce(sum(u.falta), 0) as total'))
      const ordem = f.aba === 'recebidas' ? 'u.ultima_data desc, u.operacao_id desc, u.numero desc' : 'u.vencimento asc, u.tipo asc, u.operacao_id asc, u.numero asc'
      const ls = await filtroAba(fonte()).select<{ tipo: Alvo; operacao_id: number; numero: number; n_parcelas: string; vencimento: Date | string; vencimento_original: Date | string | null; valor: string; pago: string; falta: string; cliente_id: number; cliente_nome: string; cliente_fone: string; descricao: string; ultima: number | null; ultima_data: Date | string | null }[]>('u.*')
        .orderByRaw(ordem).limit(f.limite).offset(f.offset)
      const [c] = await fonte().select<{ atrasadas: string; hoje: string; proximas: string }[]>(
        db.raw('count(*) filter (where u.falta > 0.009 and u.vencimento < ?) as atrasadas', [h]),
        db.raw('count(*) filter (where u.falta > 0.009 and u.vencimento between ? and ?) as hoje', [h, mais7]),
        db.raw('count(*) filter (where u.falta > 0.009 and u.vencimento between ? and ?) as proximas', [mais8, mais45]),
      )
      const itens: LinhaCobranca[] = ls.map((l) => ({
        tipo: l.tipo, operacaoId: l.operacao_id, numero: l.numero, nParcelas: Number(l.n_parcelas), vencimento: dia(l.vencimento)!, vencimentoOriginal: dia(l.vencimento_original), valor: Number(l.valor),
        pago: Number(l.pago), falta: Number(l.falta), cliente: { id: l.cliente_id, nome: l.cliente_nome, fone: l.cliente_fone }, descricao: l.descricao, ultimaTransacaoId: l.ultima, ultimoRecebimentoEm: dia(l.ultima_data),
      }))
      return { itens, total: Number(soma.n), valorTotal: Number(soma.total), contagens: { atrasadas: Number(c.atrasadas), hoje: Number(c.hoje), proximas: Number(c.proximas) } }
    },

    async empresa() {
      const ls = await db('sistema_config').whereIn('chave', ['empresa_nome', 'empresa_cnpj']).select<{ chave: string; valor: unknown }[]>('chave', 'valor')
      const nome = ls.find((l) => l.chave === 'empresa_nome')?.valor
      const cnpj = ls.find((l) => l.chave === 'empresa_cnpj')?.valor
      return { nome: typeof nome === 'string' && nome ? nome : 'Mundo dos iPhones', cnpj: typeof cnpj === 'string' && cnpj ? cnpj : null }
    },
  }
}
