import { distribuirAcordo, problemaDoAcordo, vencimentosAcordo } from '@/domain/acordo'
import type { Sessao } from '@/domain/escopo'
import { arred2 } from '@/domain/format'
import type { AcordoApi, AcordosApi, ResultadoAcordoApi } from './acordos'
import { ErroApi } from './clientes'
import type { EmprestimosFake } from './emprestimos.fake'
import type { AlvoApi } from './recebimentos'
import type { Parcela, VendasFake } from './vendas.fake'

interface Reg extends AcordoApi { alvo: AlvoApi; operacaoId: number }

export interface AcordosFake extends AcordosApi {
  _interno: {
    /** A regra única do acordo (a mesma no caminho direto e na aprovação do pedido do cobrador). */
    fazerAcordo(d: { alvo: AlvoApi; operacaoId: number; usuarioNome: string; valorTotal: number; n: number; primeira: string; motivo: string | null; aprovacaoId?: number; saldoEsperado?: number }): ResultadoAcordoApi
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
    const anterior = acordos.find((a) => a.alvo === d.alvo && a.operacaoId === d.operacaoId && a.status === 'ATIVO')
    if (anterior) anterior.status = 'SUBSTITUIDO'
    const id = ++seq
    for (const p of abertas) { p.valor = arred2(p.pago + p.desconto); p.quitadaEm = hoje; p.encerradaId = id }
    const proximo = Math.max(...op.parcelas.map((p) => p.numero)) + 1
    const valores = distribuirAcordo(d.valorTotal, d.n)
    const venc = vencimentosAcordo(d.primeira, d.n)
    valores.forEach((valor, i) => op.parcelas.push({ numero: proximo + i, vencimento: venc[i], vencimentoOriginal: null, valor, desconto: 0, pago: 0, quitadaEm: null, acordoId: id }))
    for (const p of pedidos) {
      if (p.alvo === d.alvo && p.operacaoId === d.operacaoId && p.status === 'PENDENTE' && p.id !== d.aprovacaoId && (p.tipo === 'DESCONTO' || p.tipo === 'ACORDO')) {
        p.status = 'RECUSADO'; p.respondidoPor = 'Geovane Cataneo'; p.respondidoEm = `${hoje}T12:00:00.000Z`; p.resposta = 'Acordo feito'
      }
    }
    acordos.push({ id, alvo: d.alvo, operacaoId: d.operacaoId, dataAcordo: hoje, saldoAntes: saldo, valorTotal: d.valorTotal, nParcelas: d.n, primeiraParcela: d.primeira, motivo: d.motivo, status: 'ATIVO', feitoPor: d.usuarioNome, aprovacaoId: d.aprovacaoId ?? null })
    return { acordoId: id, alvo: d.alvo, operacaoId: d.operacaoId, saldoAntes: saldo, valorTotal: d.valorTotal, nParcelas: d.n, primeiraParcela: d.primeira, parcelasEncerradas: abertas.length, substituiuAcordoId: anterior?.id ?? null }
  }

  return {
    _interno: { fazerAcordo },

    async fazer(s, alvo, operacaoId, e) {
      if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Só o administrador faz o acordo (o cobrador pede o acordo)', 'SEM_PERMISSAO')
      if (typeof e.valorTotal !== 'number' || typeof e.parcelas !== 'number' || typeof e.primeiraParcela !== 'string') throw new ErroApi(400, 'Informe o valor, as parcelas e a data da 1ª parcela')
      const problema = problemaDoAcordo(e, hoje)
      if (problema) throw new ErroApi(400, problema)
      let motivo: string | null = null
      if (e.motivo !== undefined && e.motivo !== null && e.motivo !== '') {
        if (typeof e.motivo !== 'string' || e.motivo.trim().length > 500) throw new ErroApi(400, 'motivo: no máximo 500 letras')
        motivo = e.motivo.trim() || null
      }
      return fazerAcordo({ alvo, operacaoId, usuarioNome: 'Geovane Cataneo', valorTotal: arred2(e.valorTotal), n: e.parcelas, primeira: e.primeiraParcela, motivo })
    },

    async listar(s, alvo, operacaoId) {
      if (s.perfil !== 'ADMIN' && s.perfil !== 'COBRADOR') throw new ErroApi(403, 'Você não tem acesso aos acordos', 'SEM_PERMISSAO')
      if (!operacao(alvo, operacaoId, s.perfil === 'ADMIN' ? undefined : s)) throw new ErroApi(404, alvo === 'VENDA' ? 'Venda não encontrada' : 'Empréstimo não encontrado', 'NAO_ENCONTRADO')
      return acordos.filter((a) => a.alvo === alvo && a.operacaoId === operacaoId).sort((a, b) => b.id - a.id).map(({ alvo: _a, operacaoId: _o, ...resto }) => resto)
    },
  }
}
