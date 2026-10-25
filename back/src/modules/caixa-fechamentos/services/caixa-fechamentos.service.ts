import { HttpError, naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import type { Sessao } from '../../../shared/perfis.js'
import { hojeBR } from '../../../shared/relogio.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import type { CaixaRepository } from '../../caixa/models/repository.js'
import type { CaixaFechamentosRepository } from '../models/repository.js'
import type { FechamentoLoja, PreviaFechamento } from '../models/types.js'

export type ListaFechamentosLoja = { hoje: string; ultimo: FechamentoLoja | null; diasSemFechar: number | null; itens: FechamentoLoja[] }

export type CaixaFechamentosService = {
  listar(s: Sessao): Promise<ListaFechamentosLoja>
  previa(s: Sessao, q: { dia?: unknown }): Promise<PreviaFechamento>
  fechar(s: Sessao, corpo: Record<string, unknown>): Promise<FechamentoLoja>
  /** Só o último fechamento se desfaz. */
  desfazer(s: Sessao, id: number): Promise<void>
}

const HISTORICO = 30
const LIMITE_ITENS = 300
const arred = (v: number) => Math.round(v * 100) / 100 + 0
const exigirAdmin = (s: Sessao) => { if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador fecha o caixa da loja') }
const ANTERIOR = (ultimo: string) => new HttpError(409, `O caixa já foi fechado até ${ultimo.split('-').reverse().join('/')}. Escolha esse dia ou um depois dele.`, 'DIA_ANTERIOR_AO_FECHADO')

/** Soma `n` dias a um AAAA-MM-DD (em UTC, sem horário de verão no meio). */
function somarDias(d: string, n: number): string {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000)

export function createCaixaFechamentosService(dep: { repo: CaixaFechamentosRepository; caixa: CaixaRepository; auditoria: AuditoriaRepository; hoje?: () => string }): CaixaFechamentosService {
  const hoje = dep.hoje ?? (() => hojeBR())

  function diaValido(v: unknown): string {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw requisicaoInvalida('dia precisa ser AAAA-MM-DD')
    if (new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) !== v) throw requisicaoInvalida('dia inválido')
    if (v < '2000-01-01') throw requisicaoInvalida('dia muito antigo')
    if (v > hoje()) throw requisicaoInvalida('Não dá para fechar um dia no futuro')
    return v
  }

  return {
    async listar(s) {
      exigirAdmin(s)
      const [itens, ultimo] = await Promise.all([dep.repo.listar(HISTORICO), dep.repo.ultimo()])
      const ontem = somarDias(hoje(), -1)
      return { hoje: hoje(), ultimo, diasSemFechar: ultimo ? Math.max(diasEntre(ultimo.dia, ontem), 0) : null, itens }
    },

    async previa(s, q) {
      exigirAdmin(s)
      const ate = diaValido(q.dia)
      const ultimo = await dep.repo.ultimo()
      if (ultimo && ate < ultimo.dia) throw ANTERIOR(ultimo.dia)
      // do dia seguinte ao último fechado até o escolhido; sem fechamento (ou fechando o mesmo dia de novo), só o dia escolhido
      const de = ultimo && ultimo.dia < ate ? somarDias(ultimo.dia, 1) : ate
      const r = await dep.caixa.periodo({ de, ate, limite: LIMITE_ITENS })
      const porLado = Object.fromEntries(Object.entries(r.porLado).map(([l, v]) => [l, { entrou: arred(v.entrou), saiu: arred(v.saiu) }])) as PreviaFechamento['porLado']
      const entrou = arred(Object.values(porLado).reduce((t, v) => t + v.entrou, 0))
      const saiu = arred(Object.values(porLado).reduce((t, v) => t + v.saiu, 0))
      return { de, ate, entrou, saiu, saldo: arred(entrou - saiu), porLado, itens: r.itens, cortado: r.total > r.itens.length }
    },

    async fechar(s, corpo) {
      exigirAdmin(s)
      const dia = diaValido(corpo.dia)
      if (corpo.obs !== undefined && corpo.obs !== null && typeof corpo.obs !== 'string') throw requisicaoInvalida('obs precisa ser texto')
      const obs = (corpo.obs as string | null | undefined)?.trim() || null
      if (obs && obs.length > 200) throw requisicaoInvalida('obs: no máximo 200 letras')
      const ultimo = await dep.repo.ultimo()
      if (ultimo && dia < ultimo.dia) throw ANTERIOR(ultimo.dia)
      const f = await dep.repo.criar({ dia, obs, usuarioId: s.usuarioId })
      await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'CAIXA_FECHADO', entidade: 'caixa_fechamento', entidadeId: f.id, depois: { dia, obs } })
      return f
    },

    async desfazer(s, id) {
      exigirAdmin(s)
      const f = await dep.repo.buscar(id)
      if (!f) throw naoEncontrado('Fechamento não encontrado')
      const ultimo = await dep.repo.ultimo()
      if (ultimo?.id !== id) throw new HttpError(409, 'Só o último fechamento se desfaz', 'NAO_E_O_ULTIMO')
      await dep.repo.excluir(id)
      await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'CAIXA_FECHAMENTO_DESFEITO', entidade: 'caixa_fechamento', entidadeId: id, antes: { dia: f.dia, obs: f.obs } })
    },
  }
}
