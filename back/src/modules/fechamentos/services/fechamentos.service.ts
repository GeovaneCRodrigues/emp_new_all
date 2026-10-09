import { HttpError, naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import type { Sessao } from '../../../shared/perfis.js'
import { hojeBR } from '../../../shared/relogio.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import type { FechamentosRepository } from '../models/repository.js'
import type { CaixaDoDia, Fechamento, StatusFechamento } from '../models/types.js'

export type ListaFechamentos = { itens: Fechamento[]; total: number; pendentes: number; pagina: number; limite: number }

export type FechamentosService = {
  hoje(s: Sessao): Promise<CaixaDoDia>
  fechar(s: Sessao): Promise<Fechamento>
  listar(s: Sessao, q: { status?: string; pagina?: number; limite?: number }): Promise<ListaFechamentos>
  conferir(s: Sessao, id: number): Promise<Fechamento>
  reabrir(s: Sessao, id: number): Promise<void>
}

const LIMITE_MAX = 100
const arred = (v: number) => Math.round(v * 100) / 100
const exigirAdmin = (s: Sessao) => { if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador confere os fechamentos') }
const exigirCobrador = (s: Sessao) => { if (s.perfil !== 'COBRADOR') throw semPermissao('Só o cobrador tem o caixa do dia') }
const JA_FECHADO = new HttpError(409, 'O dia já foi fechado. Peça ao administrador para reabrir, se precisar lançar mais alguma coisa.', 'DIA_JA_FECHADO')

export function createFechamentosService(dep: { repo: FechamentosRepository; auditoria: AuditoriaRepository; hoje?: () => string }): FechamentosService {
  const hoje = dep.hoje ?? (() => hojeBR())
  return {
    async hoje(s) {
      exigirCobrador(s)
      const data = hoje()
      const [t, recebimentos, fechamento] = await Promise.all([dep.repo.totais(s.usuarioId, data), dep.repo.recebimentos(s.usuarioId, data), dep.repo.buscarDoDia(s.usuarioId, data)])
      return { data, ...t, total: arred(t.dinheiro + t.pix + t.cartao), fechamento, recebimentos }
    },

    async fechar(s) {
      exigirCobrador(s)
      const data = hoje()
      let f: Fechamento
      try { f = await dep.repo.fechar(s.usuarioId, data) } catch (err) { if ((err as { code?: string }).code === '23505') throw JA_FECHADO; throw err }
      await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'DIA_FECHADO', entidade: 'fechamento', entidadeId: f.id, depois: { data, dinheiro: f.totalDinheiro, pix: f.totalPix, cartao: f.totalCartao } })
      return f
    },

    async listar(s, q) {
      if (s.perfil !== 'ADMIN' && s.perfil !== 'COBRADOR') throw semPermissao('Você não tem acesso aos fechamentos')
      if (q.status && q.status !== 'PENDENTE' && q.status !== 'CONFERIDO') throw requisicaoInvalida('status inválido')
      const limite = Math.min(Math.max(Math.trunc(q.limite ?? 20) || 20, 1), LIMITE_MAX)
      const pagina = Math.max(Math.trunc(q.pagina ?? 1) || 1, 1)
      const r = await dep.repo.listar({ usuarioId: s.perfil === 'COBRADOR' ? s.usuarioId : undefined, status: q.status as StatusFechamento | undefined, limite, offset: (pagina - 1) * limite })
      return { ...r, pagina, limite }
    },

    async conferir(s, id) {
      exigirAdmin(s)
      const f = await dep.repo.buscar(id)
      if (!f) throw naoEncontrado('Fechamento não encontrado')
      if (!(await dep.repo.conferir(id, s.usuarioId))) throw new HttpError(409, 'Este fechamento já foi conferido', 'JA_CONFERIDO')
      await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'DIA_CONFERIDO', entidade: 'fechamento', entidadeId: id, depois: { cobrador: f.usuario.nome, data: f.data, total: f.total } })
      return (await dep.repo.buscar(id))!
    },

    async reabrir(s, id) {
      exigirAdmin(s)
      const f = await dep.repo.buscar(id)
      if (!f) throw naoEncontrado('Fechamento não encontrado')
      if (!(await dep.repo.reabrir(id))) throw new HttpError(409, 'Fechamento já conferido não se reabre', 'JA_CONFERIDO')
      await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'DIA_REABERTO', entidade: 'fechamento', entidadeId: id, antes: { cobrador: f.usuario.nome, data: f.data, total: f.total } })
    },
  }
}
