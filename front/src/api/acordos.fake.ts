import { distribuirAcordo, PERIODICIDADES_ACORDO, problemaDoAcordo, vencimentosAcordo, type PeriodicidadeAcordo } from '@/domain/acordo'
import type { Sessao } from '@/domain/escopo'
import { arred2 } from '@/domain/format'
import type { AcordoApi, AcordosApi, ResultadoAcordoApi, ResultadoUnificarApi } from './acordos'
import { ErroApi } from './clientes'
import type { EmprestimosFake, RegistroEmprestimo } from './emprestimos.fake'
import type { AlvoApi } from './recebimentos'
import type { Parcela, VendasFake } from './vendas.fake'

interface Reg extends AcordoApi { alvo: AlvoApi; operacaoId: number }

export interface AcordosFake extends AcordosApi {
  _interno: {
    /** A regra única do acordo (a mesma no caminho direto e na aprovação do pedido do cobrador). */
    fazerAcordo(d: { alvo: AlvoApi; operacaoId: number; usuarioNome: string; valorTotal: number; n: number; primeira: string; motivo: string | null; aprovacaoId?: number; saldoEsperado?: number; capitalAdicional?: number; periodicidade?: PeriodicidadeAcordo }): ResultadoAcordoApi
  }
}

/**
 * Versão de demonstração: mesmas regras do backend. As parcelas abertas viram "encerradas por acordo" (ficam só com o
 * que já foi pago), as novas continuam a numeração e a soma fecha no centavo; o acordo anterior é substituído.
 */
export function criarAcordosFake(vendas: VendasFake, emprestimos: EmprestimosFake): AcordosFake {
  const { hoje, pedidos } = vendas._interno
  const acordos: Reg[] = []
  let seq = 0
  const faltaDe = (p: Parcela) => arred2(p.valor - p.pago - p.desconto)

  const operacao = (alvo: AlvoApi, id: number, s?: Sessao) => {
    if (alvo === 'VENDA') {
      const r = (s ? vendas._interno.noEscopo(s) : vendas._interno.registros).find((x) => x.id === id)
      return r ? { status: r.status as string, parcelas: r.parcelas } : undefined
    }
    const r = (s ? emprestimos._interno.noEscopo(s) : emprestimos._interno.registros).find((x) => x.id === id)
    return r ? { status: r.status as string, parcelas: r.parcelas } : undefined
  }

  function fazerAcordo(d: Parameters<AcordosFake['_interno']['fazerAcordo']>[0]): ResultadoAcordoApi {
    const op = operacao(d.alvo, d.operacaoId)
    if (!op) throw new ErroApi(404, d.alvo === 'VENDA' ? 'Venda não encontrada' : 'Empréstimo não encontrado', 'NAO_ENCONTRADO')
    if (op.status === 'RETOMADA' || op.status === 'CANCELADA') throw new ErroApi(409, d.alvo === 'VENDA' ? 'Esta venda foi retomada ou cancelada' : 'Este empréstimo foi cancelado', 'VENDA_ENCERRADA')
    const abertas = op.parcelas.filter((p) => faltaDe(p) > 0.009)
    if (op.status !== 'ATIVA' || !abertas.length) throw new ErroApi(409, 'Não há nada em aberto para renegociar', 'SEM_SALDO')
    const saldo = arred2(abertas.reduce((s, p) => s + faltaDe(p), 0))
    if (d.saldoEsperado !== undefined && Math.abs(saldo - d.saldoEsperado) > 0.009) {
      throw new ErroApi(409, `O que falta mudou desde o pedido (era ${d.saldoEsperado.toFixed(2).replace('.', ',')}, agora ${saldo.toFixed(2).replace('.', ',')}). Recuse o pedido e peça de novo.`, 'PEDIDO_DESATUALIZADO')
    }
    const capitalAdicional = d.capitalAdicional ?? 0
    if (capitalAdicional > 0 && d.alvo === 'EMPRESTIMO') {
      const reg = emprestimos._interno.registros.find((x) => x.id === d.operacaoId)
      if (reg) reg.capital = arred2(reg.capital + capitalAdicional)
    }
    const anterior = acordos.find((a) => a.alvo === d.alvo && a.operacaoId === d.operacaoId && a.status === 'ATIVO')
    if (anterior) anterior.status = 'SUBSTITUIDO'
    const id = ++seq
    for (const p of abertas) { p.valor = arred2(p.pago + p.desconto); p.quitadaEm = hoje; p.encerradaId = id }
    const proximo = Math.max(...op.parcelas.map((p) => p.numero)) + 1
    const valores = distribuirAcordo(d.valorTotal, d.n)
    const periodicidade = d.periodicidade ?? 'MENSAL'
    const venc = vencimentosAcordo(d.primeira, d.n, periodicidade)
    valores.forEach((valor, i) => op.parcelas.push({ numero: proximo + i, vencimento: venc[i], vencimentoOriginal: null, valor, desconto: 0, pago: 0, quitadaEm: null, acordoId: id }))
    for (const p of pedidos) {
      if (p.alvo === d.alvo && p.operacaoId === d.operacaoId && p.status === 'PENDENTE' && p.id !== d.aprovacaoId && (p.tipo === 'DESCONTO' || p.tipo === 'ACORDO')) {
        p.status = 'RECUSADO'; p.respondidoPor = 'Geovane Cataneo'; p.respondidoEm = `${hoje}T12:00:00.000Z`; p.resposta = 'Acordo feito'
      }
    }
    acordos.push({ id, alvo: d.alvo, operacaoId: d.operacaoId, dataAcordo: hoje, saldoAntes: saldo, valorTotal: d.valorTotal, nParcelas: d.n, primeiraParcela: d.primeira, periodicidade, motivo: d.motivo, capitalAdicional, status: 'ATIVO', feitoPor: d.usuarioNome, aprovacaoId: d.aprovacaoId ?? null, unificadoEmId: null, capitalCedido: 0, capitalHerdado: 0 })
    return { acordoId: id, alvo: d.alvo, operacaoId: d.operacaoId, saldoAntes: saldo, valorTotal: d.valorTotal, nParcelas: d.n, primeiraParcela: d.primeira, periodicidade, parcelasEncerradas: abertas.length, substituiuAcordoId: anterior?.id ?? null, capitalAdicional }
  }

  /** Junta empréstimos do mesmo cliente num novo (as mesmas regras do backend). */
  function unificar(e: Parameters<AcordosApi['unificar']>[1]): ResultadoUnificarApi {
    const ids = e.emprestimoIds
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 10 || !ids.every((i) => Number.isInteger(i) && i > 0)) throw new ErroApi(400, 'Escolha de 2 a 10 empréstimos para unificar')
    if (new Set(ids).size !== ids.length) throw new ErroApi(400, 'Há empréstimo repetido na seleção')
    if (typeof e.valorTotal !== 'number' || typeof e.parcelas !== 'number' || typeof e.primeiraParcela !== 'string') throw new ErroApi(400, 'Informe o valor, as parcelas e a data da 1ª parcela')
    const novo = e.capitalAdicional ?? 0
    if (typeof novo !== 'number' || !Number.isFinite(novo) || novo < 0) throw new ErroApi(400, 'Dinheiro novo: informe um valor válido (zero ou mais)')
    const periodicidade = (e.periodicidade ?? 'MENSAL') as PeriodicidadeAcordo
    if (!PERIODICIDADES_ACORDO.some((x) => x.valor === periodicidade)) throw new ErroApi(400, 'periodicidade deve ser MENSAL, QUINZENAL, SEMANAL ou DIARIA')
    const problema = problemaDoAcordo(e, hoje)
    if (problema) throw new ErroApi(400, problema)
    const regs = ids.map((i) => emprestimos._interno.registros.find((x) => x.id === i))
    if (regs.some((r) => !r)) throw new ErroApi(404, 'Empréstimo não encontrado', 'NAO_ENCONTRADO')
    const origens = regs as RegistroEmprestimo[]
    if (new Set(origens.map((r) => r.cliente.id)).size !== 1) throw new ErroApi(400, 'Só dá para unificar empréstimos do mesmo cliente', 'CLIENTES_DIFERENTES')
    const cancelado = origens.find((r) => r.status === 'CANCELADA')
    if (cancelado) throw new ErroApi(409, `O empréstimo #${cancelado.id} foi cancelado`, 'VENDA_ENCERRADA')
    const dados = origens.map((r) => {
      const abertas = r.parcelas.filter((p) => faltaDe(p) > 0.009)
      const recebido = arred2(r.amortizado + r.parcelas.reduce((x, p) => x + p.pago, 0))
      return { r, abertas, saldo: arred2(abertas.reduce((x, p) => x + faltaDe(p), 0)), cedido: arred2(r.capital - Math.min(r.capital, recebido)) }
    })
    const vazio = dados.find((d) => !d.abertas.length)
    if (vazio) throw new ErroApi(409, `O empréstimo #${vazio.r.id} não tem nada em aberto para unificar`, 'SEM_SALDO')
    let indicador: RegistroEmprestimo['indicador']; let pct: number
    if (new Set(origens.map((r) => `${r.indicador?.id ?? 'x'}|${r.pct}`)).size === 1) { indicador = origens[0].indicador; pct = origens[0].pct }
    else if (e.indicadorId === undefined) throw new ErroApi(400, 'Os empréstimos têm indicadores (ou percentuais) diferentes: escolha quem fica com o novo, ou nenhum.', 'INDICADOR_NECESSARIO')
    else if (e.indicadorId === null) { indicador = null; pct = 0 }
    else {
      const o = origens.find((r) => r.indicador?.id === e.indicadorId)
      if (!o) throw new ErroApi(400, 'Indicador não encontrado ou desativado')
      indicador = o.indicador; pct = o.pct
    }
    const saldoAntes = arred2(dados.reduce((x, d) => x + d.saldo, 0))
    const capitalHerdado = arred2(dados.reduce((x, d) => x + d.cedido, 0))
    const capital = arred2(capitalHerdado + novo)
    const valorTotal = arred2(e.valorTotal)
    const taxa = capital > 0 ? Math.min(999.9999, Math.max(0, Math.round((valorTotal / capital - 1) * 1e6) / 1e4)) : 0
    const novoId = emprestimos._interno.novoId()
    const acordoNovo = ++seq
    const valores = distribuirAcordo(valorTotal, e.parcelas)
    const venc = vencimentosAcordo(e.primeiraParcela, e.parcelas, periodicidade)
    emprestimos._interno.registros.push({
      id: novoId, cliente: origens[0].cliente, indicador, pct, dataEmprestimo: hoje, capital, modalidade: periodicidade === 'DIARIA' ? 'DIARIA' : 'PARCELADO', taxa, periodicidade, pulaDomingo: true, status: 'ATIVA',
      observacoes: `Unificação dos empréstimos ${ids.map((i) => '#' + i).join(', ')}`, amortizado: 0, unificadoDe: [...ids].sort((a, b) => a - b), unificadoEm: null,
      parcelas: valores.map((valor, i) => ({ numero: i + 1, vencimento: venc[i], vencimentoOriginal: null, valor, desconto: 0, pago: 0, quitadaEm: null, acordoId: acordoNovo })),
    })
    acordos.push({ id: acordoNovo, alvo: 'EMPRESTIMO', operacaoId: novoId, dataAcordo: hoje, saldoAntes, valorTotal, nParcelas: e.parcelas, primeiraParcela: e.primeiraParcela, periodicidade, motivo: e.motivo?.trim() || null, capitalAdicional: novo, status: 'ATIVO', feitoPor: 'Geovane Cataneo', aprovacaoId: null, unificadoEmId: null, capitalCedido: 0, capitalHerdado })
    const saida: ResultadoUnificarApi['origens'] = []
    for (const d of dados) {
      const anterior = acordos.find((a) => a.alvo === 'EMPRESTIMO' && a.operacaoId === d.r.id && a.status === 'ATIVO')
      if (anterior) anterior.status = 'SUBSTITUIDO'
      const id = ++seq
      for (const p of d.abertas) { p.valor = arred2(p.pago + p.desconto); p.quitadaEm = hoje; p.encerradaId = id }
      d.r.capital = arred2(d.r.capital - d.cedido); d.r.status = 'QUITADA'; d.r.unificadoEm = novoId
      acordos.push({ id, alvo: 'EMPRESTIMO', operacaoId: d.r.id, dataAcordo: hoje, saldoAntes: d.saldo, valorTotal: d.saldo, nParcelas: e.parcelas, primeiraParcela: e.primeiraParcela, periodicidade, motivo: e.motivo?.trim() || null, capitalAdicional: 0, status: 'ATIVO', feitoPor: 'Geovane Cataneo', aprovacaoId: null, unificadoEmId: novoId, capitalCedido: d.cedido, capitalHerdado: 0 })
      for (const p of pedidos) if (p.alvo === 'EMPRESTIMO' && p.operacaoId === d.r.id && p.status === 'PENDENTE' && (p.tipo === 'DESCONTO' || p.tipo === 'ACORDO')) { p.status = 'RECUSADO'; p.respondidoPor = 'Geovane Cataneo'; p.respondidoEm = `${hoje}T12:00:00.000Z`; p.resposta = 'Empréstimo unificado' }
      saida.push({ emprestimoId: d.r.id, saldo: d.saldo, capitalCedido: d.cedido, parcelasEncerradas: d.abertas.length, acordoId: id })
    }
    return { emprestimoId: novoId, acordoId: acordoNovo, origens: saida, saldoAntes, valorTotal, nParcelas: e.parcelas, primeiraParcela: e.primeiraParcela, periodicidade, capitalAdicional: novo, capitalHerdado, capital }
  }

  return {
    _interno: { fazerAcordo },

    async unificar(s, e) {
      if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Só o administrador unifica empréstimos', 'SEM_PERMISSAO')
      return unificar(e)
    },

    async fazer(s, alvo, operacaoId, e) {
      if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Só o administrador faz o acordo (o cobrador pede o acordo)', 'SEM_PERMISSAO')
      if (typeof e.valorTotal !== 'number' || typeof e.parcelas !== 'number' || typeof e.primeiraParcela !== 'string') throw new ErroApi(400, 'Informe o valor, as parcelas e a data da 1ª parcela')
      if (e.capitalAdicional !== undefined && (typeof e.capitalAdicional !== 'number' || !Number.isFinite(e.capitalAdicional))) throw new ErroApi(400, 'Dinheiro novo: informe um valor válido (zero ou mais)')
      if ((e.capitalAdicional ?? 0) > 0 && alvo !== 'EMPRESTIMO') throw new ErroApi(400, 'Dinheiro novo só vale em empréstimo')
      const periodicidade = (e.periodicidade ?? 'MENSAL') as PeriodicidadeAcordo
      if (!PERIODICIDADES_ACORDO.some((x) => x.valor === periodicidade)) throw new ErroApi(400, 'periodicidade deve ser MENSAL, QUINZENAL, SEMANAL ou DIARIA')
      if (alvo === 'VENDA' && periodicidade !== 'MENSAL') throw new ErroApi(400, 'O acordo de venda de iPhone é mensal')
      const problema = problemaDoAcordo(e, hoje)
      if (problema) throw new ErroApi(400, problema)
      let motivo: string | null = null
      if (e.motivo !== undefined && e.motivo !== null && e.motivo !== '') {
        if (typeof e.motivo !== 'string' || e.motivo.trim().length > 500) throw new ErroApi(400, 'motivo: no máximo 500 letras')
        motivo = e.motivo.trim() || null
      }
      return fazerAcordo({ alvo, operacaoId, usuarioNome: 'Geovane Cataneo', valorTotal: arred2(e.valorTotal), n: e.parcelas, primeira: e.primeiraParcela, motivo, capitalAdicional: arred2(e.capitalAdicional ?? 0), periodicidade })
    },

    async listar(s, alvo, operacaoId) {
      if (s.perfil !== 'ADMIN' && s.perfil !== 'COBRADOR') throw new ErroApi(403, 'Você não tem acesso aos acordos', 'SEM_PERMISSAO')
      if (!operacao(alvo, operacaoId, s.perfil === 'ADMIN' ? undefined : s)) throw new ErroApi(404, alvo === 'VENDA' ? 'Venda não encontrada' : 'Empréstimo não encontrado', 'NAO_ENCONTRADO')
      return acordos.filter((a) => a.alvo === alvo && a.operacaoId === operacaoId).sort((a, b) => b.id - a.id).map(({ alvo: _a, operacaoId: _o, ...resto }) => resto)
    },
  }
}
