import { naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import type { Sessao } from '../../../shared/perfis.js'
import { hojeBR } from '../../../shared/relogio.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import type { CaixaRepository } from '../models/repository.js'
import type { LancamentoManual, Movimento, ResumoCaixa, TipoManual } from '../models/types.js'

export type ResultadoCaixa = ResumoCaixa & { hoje: string; mes: string; itens: Movimento[]; total: number; pagina: number; limite: number }

export type CaixaService = {
  /** O caixa da loja: saldo, o que entrou e saiu no mês e o extrato. */
  ver(s: Sessao, q: { pagina?: number; limite?: number }): Promise<ResultadoCaixa>
  lancar(s: Sessao, corpo: Record<string, unknown>): Promise<LancamentoManual>
  editar(s: Sessao, id: number, corpo: Record<string, unknown>): Promise<LancamentoManual>
  excluir(s: Sessao, id: number): Promise<void>
}

const LIMITE_MAX = 100
const DINHEIRO_MAX = 1_000_000_000
const arred = (v: number) => Math.round(v * 100) / 100 + 0
const TIPOS: TipoManual[] = ['APORTE', 'RETIRADA', 'DESPESA']
const exigirAdmin = (s: Sessao) => { if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador mexe no caixa da loja') }

function diaValido(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw requisicaoInvalida('data precisa ser AAAA-MM-DD')
  const d = new Date(v + 'T12:00:00Z')
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw requisicaoInvalida('data inválida')
  if (v < '2000-01-01') throw requisicaoInvalida('data muito antiga')
  return v
}

export function createCaixaService(dep: { repo: CaixaRepository; auditoria: AuditoriaRepository; hoje?: () => string }): CaixaService {
  const hoje = dep.hoje ?? (() => hojeBR())

  /** Lê e valida um lançamento. Em `parcial` (edição), o que não veio fica como estava. */
  function ler(corpo: Record<string, unknown>, base: LancamentoManual | null): { tipo: TipoManual; valor: number; data: string; obs: string | null } {
    const tipo = corpo.tipo !== undefined || !base ? corpo.tipo : base.tipo
    if (typeof tipo !== 'string' || !TIPOS.includes(tipo as TipoManual)) throw requisicaoInvalida('tipo precisa ser APORTE, RETIRADA ou DESPESA')
    const v = corpo.valor !== undefined || !base ? corpo.valor : base.valor
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > DINHEIRO_MAX) throw requisicaoInvalida('valor precisa ser maior que zero')
    const data = corpo.data !== undefined || !base ? (corpo.data === undefined ? hoje() : diaValido(corpo.data)) : base.data
    if (data > hoje()) throw requisicaoInvalida('A data não pode ser no futuro')
    const bruta = corpo.obs !== undefined ? corpo.obs : base?.obs ?? null
    if (bruta !== null && typeof bruta !== 'string') throw requisicaoInvalida('obs precisa ser texto')
    const obs = bruta?.trim() || null
    if (obs && obs.length > 200) throw requisicaoInvalida('obs: no máximo 200 letras')
    if (tipo === 'DESPESA' && !obs) throw requisicaoInvalida('Diga com o que foi a despesa')
    return { tipo: tipo as TipoManual, valor: arred(v), data, obs }
  }

  return {
    async ver(s, q) {
      exigirAdmin(s)
      const dia = hoje()
      const limite = Math.min(Math.max(Math.trunc(q.limite ?? 25) || 25, 1), LIMITE_MAX)
      const pagina = Math.max(Math.trunc(q.pagina ?? 1) || 1, 1)
      const mes = dia.slice(0, 7)
      const [ano, m] = mes.split('-').map(Number)
      const mesFim = `${mes}-${String(new Date(Date.UTC(ano, m, 0)).getUTCDate()).padStart(2, '0')}`
      const [resumo, extrato] = await Promise.all([dep.repo.resumo({ hoje: dia, mesIni: `${mes}-01`, mesFim }), dep.repo.extrato({ hoje: dia, limite, offset: (pagina - 1) * limite })])
      return { ...resumo, saldo: arred(resumo.saldo), entrouMes: arred(resumo.entrouMes), saiuMes: arred(resumo.saiuMes), hoje: dia, mes, ...extrato, pagina, limite }
    },

    async lancar(s, corpo) {
      exigirAdmin(s)
      const d = ler(corpo, null)
      const l = await dep.repo.criarManual({ ...d, usuarioId: s.usuarioId })
      await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'CAIXA_LANCADO', entidade: 'caixa', entidadeId: l.id, depois: l })
      return l
    },

    async editar(s, id, corpo) {
      exigirAdmin(s)
      const antes = await dep.repo.buscarManual(id)
      if (!antes) throw naoEncontrado('Lançamento não encontrado (só aporte, retirada e despesa se editam)')
      const l = await dep.repo.atualizarManual(id, ler(corpo, antes))
      await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'CAIXA_EDITADO', entidade: 'caixa', entidadeId: id, antes, depois: l })
      return l
    },

    async excluir(s, id) {
      exigirAdmin(s)
      const antes = await dep.repo.buscarManual(id)
      if (!antes) throw naoEncontrado('Lançamento não encontrado (só aporte, retirada e despesa se excluem)')
      await dep.repo.excluirManual(id)
      await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'CAIXA_EXCLUIDO', entidade: 'caixa', entidadeId: id, antes })
    },
  }
}
