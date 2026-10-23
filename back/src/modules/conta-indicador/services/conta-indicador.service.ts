import { naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import type { Sessao } from '../../../shared/perfis.js'
import { hojeBR } from '../../../shared/relogio.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import type { ContaIndicadorRepository } from '../models/repository.js'
import type { ContaIndicador, SaldoIndicador } from '../models/types.js'

export type ContaIndicadorService = {
  /** O saldo de cada indicador (administrador). */
  saldos(s: Sessao): Promise<{ itens: SaldoIndicador[] }>
  /** A conta de um indicador: o administrador vê qualquer uma; o indicador só a própria. */
  ver(s: Sessao, indicadorId: number, q: { pagina?: number; limite?: number }): Promise<ContaIndicador>
  /** O indicador enviou dinheiro à loja (administrador): entra no Caixa e baixa o saldo dele. */
  lancarEnvio(s: Sessao, indicadorId: number, corpo: Record<string, unknown>): Promise<ContaIndicador>
}

const LIMITE_MAX = 100
const DINHEIRO_MAX = 100_000_000
const DATA = /^\d{4}-\d{2}-\d{2}$/
const dataValida = (v: unknown): v is string => typeof v === 'string' && DATA.test(v) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v

export function createContaIndicadorService(dep: { repo: ContaIndicadorRepository; auditoria: AuditoriaRepository; hoje?: () => string }): ContaIndicadorService {
  const hoje = dep.hoje ?? (() => hojeBR())

  async function montar(indicadorId: number, pagina: number, limite: number): Promise<ContaIndicador> {
    const ind = await dep.repo.indicador(indicadorId)
    if (!ind) throw naoEncontrado('Indicador não encontrado')
    const dia = hoje()
    const [resumo, ext] = await Promise.all([dep.repo.resumo(indicadorId, dia), dep.repo.extrato(indicadorId, { hoje: dia, limite, offset: (pagina - 1) * limite })])
    return { indicador: { id: ind.id, nome: ind.nome }, ...resumo, itens: ext.itens, total: ext.total, pagina, limite }
  }

  return {
    async saldos(s) {
      if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador vê as contas dos indicadores')
      return { itens: await dep.repo.saldos(hoje()) }
    },

    async ver(s, indicadorId, q) {
      if (s.perfil === 'INDICADOR') {
        // 404 (não 403) para não revelar que o outro indicador existe
        if (s.indicadorId !== indicadorId) throw naoEncontrado('Indicador não encontrado')
      } else if (s.perfil !== 'ADMIN') throw semPermissao('Você não tem acesso à conta do indicador')
      const limite = Math.min(Math.max(Math.trunc(q.limite ?? 50) || 50, 1), LIMITE_MAX)
      const pagina = Math.max(Math.trunc(q.pagina ?? 1) || 1, 1)
      return montar(indicadorId, pagina, limite)
    },

    async lancarEnvio(s, indicadorId, corpo) {
      if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador lança o envio do indicador')
      const ind = await dep.repo.indicador(indicadorId)
      if (!ind) throw naoEncontrado('Indicador não encontrado')
      if (typeof corpo.valor !== 'number' || !Number.isFinite(corpo.valor) || corpo.valor <= 0 || corpo.valor > DINHEIRO_MAX) throw requisicaoInvalida('Informe quanto o indicador enviou (maior que zero)')
      const valor = Math.round(corpo.valor * 100) / 100
      const dia = hoje()
      const data = corpo.data === undefined || corpo.data === null ? dia : corpo.data
      if (!dataValida(data)) throw requisicaoInvalida('data precisa ser uma data válida (AAAA-MM-DD)')
      if (data > dia) throw requisicaoInvalida('A data do envio não pode ser no futuro')
      let comprovante: string | null = null
      if (corpo.comprovante !== undefined && corpo.comprovante !== null && corpo.comprovante !== '') {
        if (typeof corpo.comprovante !== 'string' || corpo.comprovante.trim().length > 120) throw requisicaoInvalida('comprovante: no máximo 120 letras')
        comprovante = corpo.comprovante.trim() || null
      }
      let lado: 'EMPRESTIMO' | 'IPHONE' | null = null
      if (corpo.lado !== undefined && corpo.lado !== null) {
        if (corpo.lado !== 'EMPRESTIMO' && corpo.lado !== 'IPHONE') throw requisicaoInvalida('lado deve ser EMPRESTIMO ou IPHONE')
        lado = corpo.lado
      }
      await dep.repo.lancarEnvio({ indicadorId, valor, data, comprovante, lado, usuarioId: s.usuarioId })
      await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'ENVIO_INDICADOR_LANCADO', entidade: 'indicador', entidadeId: indicadorId, depois: { indicadorId, valor, data, comprovante, lado } })
      return montar(indicadorId, 1, 50)
    },
  }
}
