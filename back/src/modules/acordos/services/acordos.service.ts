import { naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import type { Sessao } from '../../../shared/perfis.js'
import { hojeBR } from '../../../shared/relogio.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import type { AlvoAcordo, ResultadoAcordo } from '../models/acordo.js'
import { validarCapitalAdicional, validarPeriodicidade, validarProposta, validarValorParcela } from '../models/acordo.js'
import type { AcordoRegistro, AcordosRepository } from '../models/repository.js'
import { UNIFICAR_MAX, UNIFICAR_MIN, type ResultadoUnificacao } from '../models/unificacao.js'

export type Entrada = Record<string, unknown>

export type AcordosService = {
  /** Só o administrador faz o acordo direto (o cobrador pede em /aprovacoes). */
  fazer(s: Sessao, alvo: AlvoAcordo, operacaoId: number, e: Entrada): Promise<ResultadoAcordo>
  /** Junta empréstimos do mesmo cliente num novo, num acordo só (administrador). */
  unificar(s: Sessao, e: Entrada): Promise<ResultadoUnificacao>
  /** O histórico de acordos da venda/empréstimo (administrador; cobrador só da carteira dele). */
  listar(s: Sessao, alvo: AlvoAcordo, operacaoId: number): Promise<AcordoRegistro[]>
}

export function createAcordosService(d: { repo: AcordosRepository; auditoria: AuditoriaRepository; hoje?: () => string }): AcordosService {
  const hoje = d.hoje ?? (() => hojeBR())
  return {
    async fazer(s, alvo, operacaoId, e) {
      if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador faz o acordo (o cobrador pede o acordo)')
      const dia = hoje()
      const p = validarProposta({ valorTotal: e.valorTotal, parcelas: e.parcelas, primeiraParcela: e.primeiraParcela }, dia)
      const capitalAdicional = validarCapitalAdicional(e.capitalAdicional, alvo)
      const periodicidade = validarPeriodicidade(e.periodicidade, alvo)
      const valorParcela = validarValorParcela(e.valorParcela, p.valorTotal, p.n)
      let motivo: string | null = null
      if (e.motivo !== undefined && e.motivo !== null && e.motivo !== '') {
        if (typeof e.motivo !== 'string' || e.motivo.trim().length > 500) throw requisicaoInvalida('motivo: no máximo 500 letras')
        motivo = e.motivo.trim() || null
      }
      const r = await d.repo.fazer({ alvo, operacaoId, usuarioId: s.usuarioId, valorTotal: p.valorTotal, n: p.n, primeira: p.primeira, motivo, dia, capitalAdicional, periodicidade, ...(valorParcela !== undefined ? { valorParcela } : {}) })
      await d.auditoria.registrar({
        usuarioId: s.usuarioId, acao: 'ACORDO_FEITO', entidade: alvo === 'VENDA' ? 'venda' : 'emprestimo', entidadeId: operacaoId,
        antes: { saldo: r.saldoAntes, parcelasEncerradas: r.parcelasEncerradas }, depois: { acordoId: r.acordoId, valorTotal: r.valorTotal, parcelas: r.nParcelas, primeiraParcela: r.primeiraParcela, periodicidade: r.periodicidade, capitalAdicional: r.capitalAdicional, substituiuAcordoId: r.substituiuAcordoId, motivo },
      })
      return r
    },

    async unificar(s, e) {
      if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador unifica empréstimos')
      const ids = e.emprestimoIds
      if (!Array.isArray(ids) || ids.length < UNIFICAR_MIN || ids.length > UNIFICAR_MAX || !ids.every((i) => typeof i === 'number' && Number.isInteger(i) && i > 0 && i < 2 ** 31)) {
        throw requisicaoInvalida(`Escolha de ${UNIFICAR_MIN} a ${UNIFICAR_MAX} empréstimos para unificar`)
      }
      const dia = hoje()
      const p = validarProposta({ valorTotal: e.valorTotal, parcelas: e.parcelas, primeiraParcela: e.primeiraParcela }, dia)
      const capitalAdicional = validarCapitalAdicional(e.capitalAdicional, 'EMPRESTIMO')
      const periodicidade = validarPeriodicidade(e.periodicidade, 'EMPRESTIMO')
      let indicadorId: number | null | undefined
      if (e.indicadorId !== undefined) {
        if (e.indicadorId !== null && (typeof e.indicadorId !== 'number' || !Number.isInteger(e.indicadorId) || e.indicadorId < 1 || e.indicadorId >= 2 ** 31)) throw requisicaoInvalida('indicadorId inválido')
        indicadorId = e.indicadorId
      }
      let motivo: string | null = null
      if (e.motivo !== undefined && e.motivo !== null && e.motivo !== '') {
        if (typeof e.motivo !== 'string' || e.motivo.trim().length > 500) throw requisicaoInvalida('motivo: no máximo 500 letras')
        motivo = e.motivo.trim() || null
      }
      const r = await d.repo.unificar({ usuarioId: s.usuarioId, emprestimoIds: ids as number[], valorTotal: p.valorTotal, n: p.n, primeira: p.primeira, periodicidade, capitalAdicional, motivo, dia, indicadorId })
      await d.auditoria.registrar({
        usuarioId: s.usuarioId, acao: 'EMPRESTIMOS_UNIFICADOS', entidade: 'emprestimo', entidadeId: r.emprestimoId,
        antes: { origens: r.origens.map((o) => ({ emprestimoId: o.emprestimoId, saldo: o.saldo, capitalCedido: o.capitalCedido })), saldo: r.saldoAntes },
        depois: { emprestimoId: r.emprestimoId, valorTotal: r.valorTotal, parcelas: r.nParcelas, primeiraParcela: r.primeiraParcela, periodicidade: r.periodicidade, capital: r.capital, capitalHerdado: r.capitalHerdado, capitalAdicional: r.capitalAdicional, motivo },
      })
      return r
    },

    async listar(s, alvo, operacaoId) {
      if (s.perfil !== 'ADMIN' && s.perfil !== 'COBRADOR') throw semPermissao('Você não tem acesso aos acordos')
      const r = await d.repo.listar(alvo, operacaoId, s.perfil === 'ADMIN' ? { tipo: 'TODOS' } : { tipo: 'CARTEIRA', usuarioId: s.usuarioId })
      if (!r) throw naoEncontrado(alvo === 'VENDA' ? 'Venda não encontrada' : 'Empréstimo não encontrado')
      return r
    },
  }
}
