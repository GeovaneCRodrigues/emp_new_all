import mysql from 'mysql2/promise'
import type { ClienteAntigo, FonteAntiga, IndicadorAntigo } from './tipos.js'
import type { EstadoAntigo } from './antigo/tipos.js'

/**
 * Lê o MySQL do sistema antigo. SÓ LEITURA: a sessão é aberta como READ ONLY e só há SELECT aqui.
 * A URL vem de OLD_MYSQL_URL (ex.: mysql://usuario:senha@127.0.0.1:3307/emp, por um túnel SSH); nunca fica em arquivo.
 */
export async function abrirFonteMysql(url: string): Promise<FonteAntiga & { estadoOperacoes(): Promise<EstadoAntigo>; fechar(): Promise<void> }> {
  const con = await mysql.createConnection({ uri: url, dateStrings: ['DATE'], decimalNumbers: false })
  await con.query('SET SESSION TRANSACTION READ ONLY')
  const ler = async <T>(sql: string): Promise<T[]> => (await con.query(sql))[0] as T[]

  return {
    async indicadores() {
      const base = await ler<Omit<IndicadorAntigo, 'percentuais'>>('SELECT id, nome, telefone, email, status FROM indicadores ORDER BY id')
      const pcts = await ler<{ indicador_id: number; pct: string; qtd: number | string }>(
        'SELECT indicador_id, percentual_parceiro AS pct, COUNT(*) AS qtd FROM operacoes WHERE indicador_id IS NOT NULL GROUP BY indicador_id, percentual_parceiro',
      )
      return base.map((i) => ({ ...i, percentuais: pcts.filter((p) => p.indicador_id === i.id).map((p) => ({ pct: Number(p.pct), qtd: Number(p.qtd) })) }))
    },
    async clientes() {
      return ler<ClienteAntigo>(
        `SELECT id, nome, cpf_cnpj, rg, telefone1, telefone2, email, endereco, numero, complemento, bairro, cidade, uf, cep,
                indicador_id, status, obs, created_at FROM clientes ORDER BY id`,
      )
    },
    /** Tudo o que o sistema antigo guarda sobre empréstimos (só SELECT; sem nome de cliente nem sócio). */
    async estadoOperacoes(): Promise<EstadoAntigo> {
      type L = Record<string, any>
      const n = (v: unknown) => (v == null ? 0 : Number(v))
      const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))
      const txt = (v: unknown) => (v == null ? null : String(v))
      const [ops, recs, extras, acordos, quits, ajs, vencs, baixas, pags, trfs, cx] = await Promise.all([
        ler<L>(`SELECT id, cliente_id, indicador_id, data_inicio, dia_vencimento, periodicidade, modalidade, valor_original, taxa_juros_mes, valor_recebimento_mensal,
                       qtde_parcelas_recuperacao, qtde_parcelas_lucro, percentual_parceiro, modo_divisao_parceiro, status, obs, created_at FROM operacoes ORDER BY id`),
        ler<L>(`SELECT id, parcela_id, operacao_id, valor, tipo, saldo_remanescente, nova_parcela_id, prazo_dias, data_pagamento, obs, cobrado_por, forma_pagamento, created_at FROM recebimentos ORDER BY id`),
        ler<L>(`SELECT id, operacao_id, parcela_origem_id, parcela_numero, total_parcelas, vencimento, valor, fase, modalidade FROM parcelas_extras ORDER BY operacao_id, parcela_numero, id`),
        ler<L>(`SELECT id, operacao_id, valor_total, capital_adicional, qtde_parcelas, valor_parcela, data_primeira_parcela, dia_vencimento, periodicidade, data_acordo, obs FROM acordos ORDER BY id`),
        ler<L>(`SELECT id, recebimento_id, operacao_id, parcela_origem_id, valor, data_pagamento, obs FROM quitacoes ORDER BY id`),
        ler<L>(`SELECT parcela_id, valor_ajustado, proporcional FROM parcela_ajustes`),
        ler<L>(`SELECT parcela_id, vencimento FROM parcela_vencimentos`),
        ler<L>(`SELECT id, recebimento_id, operacao_id, indicador_id, valor, data_repasse, obs FROM repasses_baixas ORDER BY id`),
        ler<L>(`SELECT id, indicador_id, valor, data_pagamento, obs FROM repasses_pagamentos ORDER BY id`),
        ler<L>(`SELECT id, indicador_id, valor, data_transferencia, obs FROM transferencias_indicador ORDER BY id`),
        ler<L>(`SELECT id, tipo, valor, data, obs FROM movimentacoes_caixa ORDER BY id`),
      ])
      return {
        operacoes: ops.map((o) => ({
          id: o.id, clienteId: o.cliente_id, dataInicio: String(o.data_inicio), diaVencimento: n(o.dia_vencimento), modalidade: o.modalidade, periodicidade: o.periodicidade, valorOriginal: n(o.valor_original),
          taxaJurosMes: n(o.taxa_juros_mes), valorRecebimentoMensal: n(o.valor_recebimento_mensal), qtdeParcelasRecuperacao: n(o.qtde_parcelas_recuperacao), qtdeParcelasLucro: n(o.qtde_parcelas_lucro),
          percentualParceiro: n(o.percentual_parceiro), modoDivisaoParceiro: o.modo_divisao_parceiro ?? null, indicadorId: o.indicador_id ?? null, status: String(o.status), obs: txt(o.obs), criadoEm: iso(o.created_at),
        })),
        recebimentos: recs.map((r) => ({
          id: r.id, parcelaId: String(r.parcela_id), operacaoId: r.operacao_id, valor: n(r.valor), tipo: r.tipo, saldoRemanescente: n(r.saldo_remanescente), novaParcelaId: txt(r.nova_parcela_id),
          prazoDias: r.prazo_dias == null ? null : Number(r.prazo_dias), dataPagamento: String(r.data_pagamento), obs: txt(r.obs), cobradoPor: r.cobrado_por ?? 'OWNER', forma: r.forma_pagamento ?? null, criadoEm: iso(r.created_at),
        })),
        parcelasExtras: extras.map((e) => ({ id: String(e.id), operacaoId: e.operacao_id, parcelaOrigemId: String(e.parcela_origem_id), parcelaNumero: n(e.parcela_numero), totalParcelas: n(e.total_parcelas), vencimentoIso: String(e.vencimento), valor: n(e.valor), fase: String(e.fase), modalidade: String(e.modalidade) })),
        parcelaAjustes: Object.fromEntries(ajs.map((a) => [String(a.parcela_id), { valorAjustado: n(a.valor_ajustado), proporcional: Boolean(a.proporcional) }])),
        parcelaVencimentos: Object.fromEntries(vencs.map((v) => [String(v.parcela_id), { vencimentoIso: String(v.vencimento) }])),
        quitacoes: quits.map((q) => ({ id: q.id, recebimentoId: q.recebimento_id, operacaoId: q.operacao_id, parcelaOrigemId: String(q.parcela_origem_id), valor: n(q.valor), dataPagamento: String(q.data_pagamento), obs: txt(q.obs) })),
        acordos: acordos.map((a) => ({ id: a.id, operacaoId: a.operacao_id, valorTotal: n(a.valor_total), capitalAdicional: n(a.capital_adicional), qtdeParcelas: n(a.qtde_parcelas), valorParcela: n(a.valor_parcela), dataPrimeiraParcela: String(a.data_primeira_parcela), diaVencimento: n(a.dia_vencimento), periodicidade: a.periodicidade, dataAcordo: String(a.data_acordo), obs: txt(a.obs) })),
        repassesBaixas: baixas.map((b) => ({ id: b.id, recebimentoId: b.recebimento_id, operacaoId: b.operacao_id, indicadorId: b.indicador_id, valor: n(b.valor), dataRepasse: String(b.data_repasse), obs: txt(b.obs) })),
        repassesPagamentos: pags.map((b) => ({ id: b.id, indicadorId: b.indicador_id, valor: n(b.valor), dataPagamento: String(b.data_pagamento), obs: txt(b.obs) })),
        transferencias: trfs.map((b) => ({ id: b.id, indicadorId: b.indicador_id, valor: n(b.valor), dataTransferencia: String(b.data_transferencia), obs: txt(b.obs) })),
        movimentacoesCaixa: cx.map((m) => ({ id: m.id, tipo: m.tipo, valor: n(m.valor), data: String(m.data), obs: txt(m.obs) })),
      }
    },
    async fechar() { await con.end() },
  }
}
