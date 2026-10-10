import type { Knex } from 'knex'
import type { EstadoVendasAntigo } from './antigo/tipos-vendas.js'
import { alinharSequenciaDeRecibos } from './importar-operacoes.js'
import { transformarBem, transformarVenda, type BemNovo, type VendaNova } from './antigo/transformar-vendas.js'

export interface RelatorioVendas {
  modo: 'SIMULACAO' | 'APLICADO'
  bens: { origem: number; criados: number; jaExistiam: number; semCliente: number }
  vendas: { origem: number; criadas: number; jaExistiam: number; semConversao: number; semCliente: number; semIndicador: number; semAparelho: number }
  parcelas: number
  recibos: number
  repasses: { criados: number; jaExistiam: number; semIndicador: number }
  recibosRenumerados: boolean
  totais: { investido: number; vendido: number; recebido: number; descontos: number; repassado: number }
  avisos: Record<string, number>
  problemas: { entidade: string; legacyId: number; motivo: string }[]
  conferencias: string[]
}

class Divergencia extends Error {}
const r2 = (v: number) => Math.round(v * 100) / 100
const soma = (xs: number[]) => r2(xs.reduce((a, b) => a + b, 0))

/**
 * Traz o estoque e as vendas de iPhones do sistema antigo (aparelhos, vendas, parcelas, entradas e recebimentos, repasses).
 * Clientes e indicadores (etapa 1) têm de ter vindo antes. Tudo numa transação: simulando, ela é desfeita no fim;
 * aplicando, só confirma se TODAS as conferências (contra a origem) fecharem. Rodar de novo não duplica.
 */
export async function importarVendas(db: Knex, estado: EstadoVendasAntigo, opcoes: { aplicar: boolean }): Promise<RelatorioVendas> {
  const avisos: Record<string, number> = {}
  const conta = (c: string) => { avisos[c] = (avisos[c] ?? 0) + 1 }
  const problemas: RelatorioVendas['problemas'] = []
  const rel: RelatorioVendas = {
    modo: opcoes.aplicar ? 'APLICADO' : 'SIMULACAO',
    bens: { origem: estado.bens.length, criados: 0, jaExistiam: 0, semCliente: 0 },
    vendas: { origem: estado.vendas.length, criadas: 0, jaExistiam: 0, semConversao: 0, semCliente: 0, semIndicador: 0, semAparelho: 0 },
    parcelas: 0, recibos: 0, repasses: { criados: 0, jaExistiam: 0, semIndicador: 0 }, recibosRenumerados: false,
    totais: { investido: 0, vendido: 0, recebido: 0, descontos: 0, repassado: 0 }, avisos, problemas, conferencias: [],
  }

  const bens: BemNovo[] = []
  for (const b of estado.bens) { const r = transformarBem(b); r.avisos.forEach((a) => conta(`bem.${a}`)); bens.push(r.novo) }
  const vendas: VendaNova[] = []
  for (const v of estado.vendas) {
    const r = transformarVenda(v, estado)
    r.avisos.forEach((a) => conta(`venda.${a}`))
    if (!r.novo) { rel.vendas.semConversao++; problemas.push({ entidade: 'venda', legacyId: v.id, motivo: r.erro ?? 'não converteu' }); continue }
    vendas.push(r.novo)
  }

  const trx = await db.transaction()
  try {
    const mapa = async (tabela: string) => new Map((await trx(tabela).whereNotNull('legacy_id').select<{ id: number; legacy_id: number }[]>('id', 'legacy_id')).map((l) => [l.legacy_id, l.id]))
    const idCliente = await mapa('clientes'), idIndicador = await mapa('indicadores')
    const idBem = await mapa('bens')

    // ---------- aparelhos ----------
    for (const b of bens) {
      if (idBem.has(b.legacyId)) { rel.bens.jaExistiam++; continue }
      let encomenda: number | null = null
      if (b.clienteEncomendaLegacyId !== null) {
        encomenda = idCliente.get(b.clienteEncomendaLegacyId) ?? null
        if (encomenda === null) { rel.bens.semCliente++; problemas.push({ entidade: 'aparelho', legacyId: b.legacyId, motivo: 'o cliente da encomenda ainda não foi importado' }); continue }
      }
      const [{ id }] = await trx('bens').insert({
        modelo: b.modelo, gb: b.gb, cor: b.cor, bateria: b.bateria, condicao: b.condicao, imei: b.imei, valor_compra: b.valorCompra, custos_extras: b.custosExtras, preco_venda: b.precoVenda,
        estado: b.estado, origem: b.origem, data_compra: b.dataCompra, cliente_encomenda_id: encomenda, observacoes: b.observacoes, legacy_id: b.legacyId,
      }).returning('id')
      idBem.set(b.legacyId, id); rel.bens.criados++
    }

    // ---------- vendas, parcelas, recibos ----------
    const entraram: VendaNova[] = []
    const recibos: { v: VendaNova; vendaId: number; clienteId: number; parcelaId: Map<number, number>; p: VendaNova['pagamentos'][number] }[] = []
    for (const v of vendas) {
      if (await trx('vendas').where({ legacy_id: v.legacyId }).first('id')) { rel.vendas.jaExistiam++; continue }
      const clienteId = idCliente.get(v.clienteLegacyId)
      if (clienteId === undefined) { rel.vendas.semCliente++; problemas.push({ entidade: 'venda', legacyId: v.legacyId, motivo: 'o cliente ainda não foi importado' }); continue }
      const bemId = idBem.get(v.bemLegacyId)
      if (bemId === undefined) { rel.vendas.semAparelho++; problemas.push({ entidade: 'venda', legacyId: v.legacyId, motivo: 'o aparelho não foi importado' }); continue }
      let indicadorId: number | null = null
      if (v.indicadorLegacyId !== null) {
        indicadorId = idIndicador.get(v.indicadorLegacyId) ?? null
        if (indicadorId === null) { rel.vendas.semIndicador++; problemas.push({ entidade: 'venda', legacyId: v.legacyId, motivo: 'o indicador ainda não foi importado' }); continue }
      }
      const trocaBemId = v.trocaBemLegacyId !== null ? idBem.get(v.trocaBemLegacyId) ?? null : null
      const quando = v.criadoEm ?? `${v.dataVenda}T12:00:00Z`
      const [{ id: vendaId }] = await trx('vendas').insert({
        bem_id: bemId, cliente_id: clienteId, vendedor_id: null, indicador_id: indicadorId, percentual_indicador: v.pct, data_venda: v.dataVenda, entrada: v.entrada, troca_valor: v.troca, troca_bem_id: trocaBemId,
        valor_investido: v.investido, valor_total: v.total,
        // o antigo não guardava o preço sem juros nem o % de juros: o preço fica igual ao total pago (sem juros separado)
        preco_acordado: v.total, juros_pct: 0, status: v.status, observacoes: v.observacoes, legacy_id: v.legacyId, created_at: quando, updated_at: quando,
      }).returning('id')
      const parcelaId = new Map<number, number>()
      for (const p of v.parcelas) {
        const [{ id }] = await trx('venda_parcelas').insert({
          venda_id: vendaId, numero: p.numero, vencimento: p.vencimento, vencimento_original: p.vencimentoOriginal, valor: p.valor, desconto: p.desconto, quitada_em: p.quitadaEm, legacy_id: p.legacyId, created_at: quando, updated_at: quando,
        }).returning('id')
        parcelaId.set(p.numero, id); rel.parcelas++
      }
      rel.vendas.criadas++
      rel.totais.investido = r2(rel.totais.investido + v.investido); rel.totais.vendido = r2(rel.totais.vendido + v.total)
      rel.totais.descontos = r2(rel.totais.descontos + soma(v.parcelas.map((p) => p.desconto)))
      entraram.push(v)
      for (const p of v.pagamentos) recibos.push({ v, vendaId, clienteId, parcelaId, p })
    }

    recibos.sort((a, b) => a.p.data.localeCompare(b.p.data) || a.p.legacyRecebimentoId - b.p.legacyRecebimentoId)
    await alinharSequenciaDeRecibos(trx)
    for (const r of recibos) {
      const p = r.p
      if (await trx('transacoes_recebimento').where({ legacy_venda_recebimento_id: p.legacyRecebimentoId }).first('id')) { conta('recibo_ja_existia'); continue }
      const quando = p.criadoEm ?? `${p.data}T12:00:00Z`
      const [{ n }] = (await trx.raw("select nextval('recibo_numero_seq') as n")).rows
      const [{ id: transacaoId }] = await trx('transacoes_recebimento').insert({
        numero_recibo: Number(n), cliente_id: r.clienteId, valor_total: p.valorTotal, forma_pagamento: 'PIX', forma_estimada: true, data_recebimento: p.data, recebido_por: null,
        resumo: JSON.stringify(p.resumo), legacy_venda_recebimento_id: p.legacyRecebimentoId, created_at: quando, updated_at: quando,
      }).returning('id')
      if (p.tipo === 'ENTRADA') {
        await trx('recebimentos').insert({ transacao_id: transacaoId, tipo: 'ENTRADA', venda_id: r.vendaId, valor: p.valorTotal, created_at: quando, updated_at: quando })
      } else {
        for (const it of p.itens) await trx('recebimentos').insert({ transacao_id: transacaoId, tipo: 'PARCELA', venda_parcela_id: r.parcelaId.get(it.numeroParcela), valor: it.valor, antes: JSON.stringify(it.antes), created_at: quando, updated_at: quando })
      }
      rel.recibos++
    }

    // ---------- repasses de venda ----------
    for (const x of estado.repasses) {
      const legacy = `venda-${x.id}`
      if (await trx('repasses_indicador').where({ legacy_id: legacy }).first('id')) { rel.repasses.jaExistiam++; continue }
      const ind = x.indicadorId !== null ? idIndicador.get(x.indicadorId) : undefined
      if (ind === undefined) { rel.repasses.semIndicador++; problemas.push({ entidade: 'repasse de venda', legacyId: x.id, motivo: 'o indicador ainda não foi importado' }); continue }
      await trx('repasses_indicador').insert({
        indicador_id: ind, valor: x.valor, data_repasse: x.dataRepasse, forma_pagamento: 'PIX', obs: [x.obs?.trim(), 'Importado do sistema antigo (forma de pagamento não registrada).'].filter(Boolean).join(' — '),
        legacy_id: legacy, created_at: `${x.dataRepasse}T12:00:00Z`, updated_at: `${x.dataRepasse}T12:00:00Z`,
      })
      rel.repasses.criados++; rel.totais.repassado = r2(rel.totais.repassado + x.valor)
    }

    // ---------- numeração dos recibos ----------
    // Empréstimos e vendas foram importados em momentos diferentes: se só existem recibos do antigo, a numeração é refeita por data.
    const nativos = Number(((await trx('transacoes_recebimento').whereNull('legacy_id').whereNull('legacy_venda_recebimento_id').count('* as n').first()) as { n: string }).n)
    if (nativos === 0 && rel.recibos > 0) {
      await trx.raw('update transacoes_recebimento set numero_recibo = numero_recibo + 100000000')
      await trx.raw(`with r as (select id, row_number() over (order by data_recebimento, coalesce(legacy_id, 0), coalesce(legacy_venda_recebimento_id, 0), id) rn from transacoes_recebimento)
                     update transacoes_recebimento t set numero_recibo = r.rn from r where r.id = t.id`)
      // simulando, a sequência (que não volta atrás no rollback) fica quieta
      if (opcoes.aplicar) await trx.raw("select setval('recibo_numero_seq', (select coalesce(max(numero_recibo), 1) from transacoes_recebimento))")
      rel.recibosRenumerados = true
    } else if (rel.recibos > 0) conta('recibos_nao_renumerados_ha_recibos_novos')

    // ---------- conferências (se alguma falhar, nada é gravado) ----------
    const confere = (ok: boolean, descricao: string) => { if (!ok) throw new Divergencia(`Conferência falhou: ${descricao}`); rel.conferencias.push(`ok: ${descricao}`) }
    const num = async (sql: string, bind: unknown[] = []) => Number((await trx.raw(sql, bind as never)).rows[0].v)
    const legacys = entraram.map((v) => v.legacyId)
    const bensOk = await num('select count(*)::float as v from bens where legacy_id = any(?)', [bens.map((b) => b.legacyId)])
    confere(bensOk === bens.length - rel.bens.semCliente, `${bensOk} dos ${bens.length} aparelhos do sistema antigo estão no estoque novo`)
    const vendasBanco = await num('select count(*)::float as v from vendas where legacy_id = any(?)', [legacys])
    confere(vendasBanco === rel.vendas.criadas, `${vendasBanco} vendas gravadas = ${rel.vendas.criadas} convertidas`)

    const nasQueEntraram = new Set(legacys)
    const recsOrigem = estado.recebimentos.filter((r) => nasQueEntraram.has(r.vendaId))
    const recebidoOrigem = soma(recsOrigem.map((r) => r.valor))
    const recebidoNovo = await num(`select coalesce(sum(v.entrada + v.troca_valor + coalesce((select sum(r.valor) from recebimentos r join venda_parcelas p on p.id = r.venda_parcela_id where p.venda_id = v.id), 0)), 0)::float as v from vendas v where v.legacy_id = any(?)`, [legacys])
    rel.totais.recebido = r2(recebidoNovo)
    confere(r2(recebidoNovo) === recebidoOrigem, `recebido (entrada + troca + parcelas) no sistema novo R$ ${r2(recebidoNovo)} = no antigo R$ ${recebidoOrigem}`)
    const descOrigem = soma(recsOrigem.map((r) => r.desconto))
    const descNovo = await num('select coalesce(sum(p.desconto),0)::float as v from venda_parcelas p join vendas v on v.id = p.venda_id where v.legacy_id = any(?)', [legacys])
    confere(r2(descNovo) === descOrigem, `descontos no sistema novo R$ ${r2(descNovo)} = no antigo R$ ${descOrigem}`)
    const totalOrigem = soma(estado.vendas.filter((v) => nasQueEntraram.has(v.id)).map((v) => v.valorTotal))
    const totalNovo = await num('select coalesce(sum(valor_total),0)::float as v from vendas where legacy_id = any(?)', [legacys])
    confere(r2(totalNovo) === totalOrigem, `total vendido no sistema novo R$ ${r2(totalNovo)} = no antigo R$ ${totalOrigem}`)
    const invOrigem = soma(estado.vendas.filter((v) => nasQueEntraram.has(v.id)).map((v) => v.valorInvestido))
    const invNovo = await num('select coalesce(sum(valor_investido),0)::float as v from vendas where legacy_id = any(?)', [legacys])
    confere(r2(invNovo) === invOrigem, `investido no sistema novo R$ ${r2(invNovo)} = no antigo R$ ${invOrigem}`)
    const parcOrigem = estado.parcelas.filter((p) => nasQueEntraram.has(p.vendaId)).length
    const parcBanco = await num('select count(*)::float as v from venda_parcelas p join vendas v on v.id = p.venda_id where v.legacy_id = any(?)', [legacys])
    confere(parcBanco === parcOrigem, `${parcBanco} parcelas no sistema novo = ${parcOrigem} no antigo`)
    const parcValorOrigem = soma(estado.parcelas.filter((p) => nasQueEntraram.has(p.vendaId)).map((p) => p.valor))
    const parcValorNovo = await num('select coalesce(sum(p.valor),0)::float as v from venda_parcelas p join vendas v on v.id = p.venda_id where v.legacy_id = any(?)', [legacys])
    confere(r2(parcValorNovo) === parcValorOrigem, `valor das parcelas no sistema novo R$ ${r2(parcValorNovo)} = no antigo R$ ${parcValorOrigem}`)
    const recibosOrigem = recsOrigem.filter((r) => r.tipo !== 'TROCA' && r.valor > 0.009).length
    confere(rel.recibos === recibosOrigem, `${rel.recibos} recibos gravados = ${recibosOrigem} recebimentos de entrada e parcela no antigo (a troca não gera recibo)`)
    const estourou = await num('select count(*)::float as v from venda_parcelas p join vendas v on v.id=p.venda_id left join (select venda_parcela_id id, sum(valor) pago from recebimentos group by 1) r on r.id=p.id where v.legacy_id = any(?) and coalesce(r.pago,0) + p.desconto > p.valor + 0.009', [legacys])
    confere(estourou === 0, 'nenhuma parcela recebeu (dinheiro + desconto) mais do que o seu valor')
    const quitadaComSaldo = await num("select count(*)::float as v from vendas v where v.legacy_id = any(?) and v.status='QUITADA' and exists (select 1 from venda_parcelas p left join (select venda_parcela_id id, sum(valor) pago from recebimentos group by 1) r on r.id=p.id where p.venda_id=v.id and p.valor - p.desconto - coalesce(r.pago,0) > 0.009)", [legacys])
    confere(quitadaComSaldo === 0, 'nenhuma venda quitada tem parcela em aberto')
    const ativaSemSaldo = await num("select count(*)::float as v from vendas v where v.legacy_id = any(?) and v.status='ATIVA' and not exists (select 1 from venda_parcelas p left join (select venda_parcela_id id, sum(valor) pago from recebimentos group by 1) r on r.id=p.id where p.venda_id=v.id and p.valor - p.desconto - coalesce(r.pago,0) > 0.009)", [legacys])
    confere(ativaSemSaldo === 0, 'nenhuma venda ativa está sem parcela em aberto')
    const vendidoSemVenda = await num("select count(*)::float as v from bens b where b.estado='VENDIDO' and b.legacy_id = any(?) and not exists (select 1 from vendas v where v.bem_id=b.id and v.status not in ('CANCELADA','RETOMADA'))", [bens.map((b) => b.legacyId)])
    confere(vendidoSemVenda === 0, 'todo aparelho vendido tem a sua venda')
    const numeros = await num('select count(distinct numero_recibo)::float as v from transacoes_recebimento')
    const totalRecibos = await num('select count(*)::float as v from transacoes_recebimento')
    confere(numeros === totalRecibos, 'nenhum número de recibo repetido')

    if (opcoes.aplicar) await trx.commit()
    else await trx.rollback()
  } catch (e) {
    await trx.rollback().catch(() => undefined)
    throw e
  }
  return rel
}

export function formatarRelatorioVendas(r: RelatorioVendas): string {
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const l: string[] = [r.modo === 'SIMULACAO' ? 'SIMULAÇÃO: nada foi gravado.' : 'APLICADO: dados gravados.']
  l.push(`Aparelhos: ${r.bens.origem} no sistema antigo → ${r.bens.criados} criados, ${r.bens.jaExistiam} já existiam, ${r.bens.semCliente} sem cliente da encomenda.`)
  const v = r.vendas
  l.push(`Vendas: ${v.origem} no sistema antigo → ${v.criadas} criadas, ${v.jaExistiam} já existiam, ${v.semConversao} sem conversão, ${v.semCliente} sem cliente, ${v.semIndicador} sem indicador, ${v.semAparelho} sem aparelho.`)
  l.push(`Parcelas: ${r.parcelas}. Recibos: ${r.recibos}${r.recibosRenumerados ? ' (numeração dos recibos refeita por data)' : ''}. Repasses de venda: ${r.repasses.criados} criados, ${r.repasses.jaExistiam} já existiam.`)
  l.push(`Totais (do que entrou agora): investido ${brl(r.totais.investido)}, vendido ${brl(r.totais.vendido)}, recebido ${brl(r.totais.recebido)}, descontos ${brl(r.totais.descontos)}, repassado ${brl(r.totais.repassado)}.`)
  const chaves = Object.keys(r.avisos).sort()
  if (chaves.length) { l.push('Avisos (quantidade):'); for (const k of chaves) l.push(`  ${k}: ${r.avisos[k]}`) }
  if (r.problemas.length) { l.push('Não entraram (id do sistema antigo):'); for (const p of r.problemas) l.push(`  ${p.entidade} ${p.legacyId}: ${p.motivo}`) }
  l.push('Conferências:'); for (const c of r.conferencias) l.push(`  ${c}`)
  return l.join('\n')
}
