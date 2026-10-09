import { naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import type { Sessao } from '../../../shared/perfis.js'
import { hojeBR } from '../../../shared/relogio.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import type { AlvoAcordo, ResultadoAcordo } from '../models/acordo.js'
import { validarProposta } from '../models/acordo.js'
import type { AcordoRegistro, AcordosRepository } from '../models/repository.js'

export type Entrada = Record<string, unknown>

export type AcordosService = {
  /** Só o administrador faz o acordo direto (o cobrador pede em /aprovacoes). */
  fazer(s: Sessao, alvo: AlvoAcordo, operacaoId: number, e: Entrada): Promise<ResultadoAcordo>
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
      let motivo: string | null = null
      if (e.motivo !== undefined && e.motivo !== null && e.motivo !== '') {
        if (typeof e.motivo !== 'string' || e.motivo.trim().length > 500) throw requisicaoInvalida('motivo: no máximo 500 letras')
        motivo = e.motivo.trim() || null
      }
      const r = await d.repo.fazer({ alvo, operacaoId, usuarioId: s.usuarioId, valorTotal: p.valorTotal, n: p.n, primeira: p.primeira, motivo, dia })
      await d.auditoria.registrar({
        usuarioId: s.usuarioId, acao: 'ACORDO_FEITO', entidade: alvo === 'VENDA' ? 'venda' : 'emprestimo', entidadeId: operacaoId,
        antes: { saldo: r.saldoAntes, parcelasEncerradas: r.parcelasEncerradas }, depois: { acordoId: r.acordoId, valorTotal: r.valorTotal, parcelas: r.nParcelas, primeiraParcela: r.primeiraParcela, substituiuAcordoId: r.substituiuAcordoId, motivo },
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
