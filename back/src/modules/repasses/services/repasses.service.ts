import { HttpError, naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import type { Sessao } from '../../../shared/perfis.js'
import { hojeBR } from '../../../shared/relogio.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import type { EmprestimosRepository } from '../../emprestimos/models/repository.js'
import type { IndicadoresRepository } from '../../indicadores/models/repository.js'
import type { VendasRepository } from '../../vendas/models/repository.js'
import { arred2 } from '../../vendas/services/calculo.js'
import { contas } from '../../vendas/services/contas.js'
import type { FormaRepasse, RepasseRegistro, RepassesRepository } from '../models/repository.js'
import { calcularRepasse, type OperacaoRepasse, type ResumoRepasse } from './calculo.js'

export type Entrada = Record<string, unknown>
export type ResumoDoIndicador = { indicador: { id: number; nome: string; chavePix: string | null; ativo: boolean }; resumo: Omit<ResumoRepasse, 'operacoes'>; nOperacoes: number }
export type DetalheDoIndicador = ResumoDoIndicador & { operacoes: ResumoRepasse['operacoes']; repasses: RepasseRegistro[] }

export type RepassesService = {
  /** Todos os indicadores com a pagar / já pago / vai liberar (administrador). */
  resumo(s: Sessao): Promise<ResumoDoIndicador[]>
  /** Um indicador por dentro: cada operação (venda ou empréstimo) e os pagamentos. O indicador vê só o dele. */
  detalhe(s: Sessao, indicadorId: number): Promise<DetalheDoIndicador>
  /** Registra um repasse (total ou parcial). Só o administrador, e nunca mais do que está a pagar. */
  pagar(s: Sessao, indicadorId: number, e: Entrada): Promise<{ repasse: RepasseRegistro; detalhe: DetalheDoIndicador }>
  /** Os repasses já feitos, do mais novo ao mais antigo (administrador; opcionalmente de um indicador). */
  jaPagos(s: Sessao, indicadorId?: number): Promise<RepasseRegistro[]>
}

type Dependencias = {
  repo: RepassesRepository
  indicadores: IndicadoresRepository
  vendas: VendasRepository
  emprestimos: EmprestimosRepository
  auditoria: AuditoriaRepository
  hoje?: () => string
}

const FORMAS: FormaRepasse[] = ['PIX', 'DINHEIRO', 'TRANSFERENCIA']
const DATA = /^\d{4}-\d{2}-\d{2}$/
const dataValida = (v: unknown): v is string => typeof v === 'string' && DATA.test(v) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v
const DINHEIRO_MAX = 100_000_000
export const VALOR_ACIMA_DO_LIBERADO = 'VALOR_ACIMA_DO_LIBERADO'

export function createRepassesService(d: Dependencias): RepassesService {
  const hoje = d.hoje ?? (() => hojeBR())
  const tudo = { tipo: 'TODOS' } as const

  /** As operações de TODOS os indicadores, agrupadas por indicador. */
  async function operacoesPorIndicador(): Promise<Map<number, OperacaoRepasse[]>> {
    const dia = hoje()
    const mapa = new Map<number, OperacaoRepasse[]>()
    const pôr = (id: number, o: OperacaoRepasse) => mapa.set(id, [...(mapa.get(id) ?? []), o])
    for (const v of await d.vendas.listar(tudo)) {
      if (!v.indicador) continue
      const c = contas({ entrada: v.entrada, troca: v.troca, investido: v.investido, pct: v.pct, statusGravado: v.status, parcelas: v.parcelas.map((p) => ({ valor: p.valor, desconto: p.desconto, pago: p.pago, vencimento: p.vencimento })) }, dia)
      pôr(v.indicador.id, {
        tipo: 'VENDA', id: v.id, data: v.dataVenda, clienteNome: v.cliente.nome, descricao: `${v.aparelho.modelo} ${v.aparelho.gb} GB`,
        status: c.status as OperacaoRepasse['status'], pct: v.pct, investido: v.investido, total: c.total, descontos: c.descontos, recebido: c.recebido,
      })
    }
    for (const e of await d.emprestimos.listar(tudo)) {
      if (!e.indicador) continue
      const c = contas({ entrada: e.amortizado, troca: 0, investido: e.capital, pct: e.pct, statusGravado: e.status, parcelas: e.parcelas.map((p) => ({ valor: p.valor, desconto: p.desconto, pago: p.pago, vencimento: p.vencimento })) }, dia)
      pôr(e.indicador.id, {
        tipo: 'EMPRESTIMO', id: e.id, data: e.dataEmprestimo, clienteNome: e.cliente.nome, descricao: `Empréstimo ${e.modalidade === 'JUROS' ? 'só juros' : e.modalidade === 'DIARIA' ? 'diário' : 'parcelado'}`,
        status: c.status as OperacaoRepasse['status'], pct: e.pct, investido: e.capital, total: c.total, descontos: c.descontos, recebido: c.recebido,
      })
    }
    return mapa
  }

  async function detalheDe(id: number, pago?: number): Promise<DetalheDoIndicador> {
    const ind = await d.indicadores.buscar(id)
    if (!ind) throw naoEncontrado('Indicador não encontrado')
    const ops = (await operacoesPorIndicador()).get(id) ?? []
    const repasses = await d.repo.listar({ indicadorId: id, limite: 200 })
    const totalPago = pago ?? (await d.repo.totaisPagos()).get(id) ?? 0
    const { operacoes, ...resumo } = calcularRepasse(ops, totalPago)
    return { indicador: { id: ind.id, nome: ind.nome, chavePix: ind.chavePix, ativo: ind.ativo }, resumo, nOperacoes: operacoes.length, operacoes, repasses }
  }

  return {
    async resumo(s) {
      if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador vê os repasses de todos')
      const [indicadores, ops, pagos] = await Promise.all([d.indicadores.listar(), operacoesPorIndicador(), d.repo.totaisPagos()])
      return indicadores.map((i) => {
        const { operacoes, ...resumo } = calcularRepasse(ops.get(i.id) ?? [], pagos.get(i.id) ?? 0)
        return { indicador: { id: i.id, nome: i.nome, chavePix: i.chavePix, ativo: i.ativo }, resumo, nOperacoes: operacoes.length }
      })
    },

    async detalhe(s, id) {
      if (s.perfil === 'INDICADOR') {
        // 404 (não 403) para não revelar que o outro indicador existe
        if (s.indicadorId !== id) throw naoEncontrado('Indicador não encontrado')
      } else if (s.perfil !== 'ADMIN') throw semPermissao('Você não tem acesso aos repasses')
      const d2 = await detalheDe(id)
      // o capital (custo do aparelho / valor emprestado) é da loja: o indicador só vê o que é dele
      if (s.perfil === 'INDICADOR') return { ...d2, operacoes: d2.operacoes.map(({ investido: _investido, ...o }) => o) as DetalheDoIndicador['operacoes'] }
      return d2
    },

    async pagar(s, id, e) {
      if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador paga o repasse')
      if (typeof e.valor !== 'number' || !Number.isFinite(e.valor) || e.valor <= 0 || e.valor > DINHEIRO_MAX) throw requisicaoInvalida('valor precisa ser maior que zero')
      const valor = arred2(e.valor)
      if (typeof e.forma !== 'string' || !FORMAS.includes(e.forma as FormaRepasse)) throw requisicaoInvalida('forma deve ser PIX, DINHEIRO ou TRANSFERENCIA')
      const dia = hoje()
      let data = dia
      if (e.data !== undefined && e.data !== null) {
        if (!dataValida(e.data)) throw requisicaoInvalida('data precisa ser uma data válida (AAAA-MM-DD)')
        if (e.data > dia) throw requisicaoInvalida('A data do repasse não pode ser no futuro')
        if (e.data < '2020-01-01') throw requisicaoInvalida('A data do repasse é antiga demais')
        data = e.data
      }
      let obs: string | null = null
      if (e.obs !== undefined && e.obs !== null && e.obs !== '') {
        if (typeof e.obs !== 'string' || e.obs.trim().length > 300) throw requisicaoInvalida('obs: no máximo 300 letras')
        obs = e.obs.trim() || null
      }
      if (!(await d.indicadores.buscar(id))) throw naoEncontrado('Indicador não encontrado')

      // trava o indicador, confere quanto está a pagar com o total já pago de verdade, e só então grava
      const repasse = await d.repo.comTrava(id, async (tx) => {
        const pago = await tx.totalPago()
        const { aPagar } = calcularRepasse((await operacoesPorIndicador()).get(id) ?? [], pago)
        if (valor > aPagar + 0.004) {
          throw new HttpError(409, aPagar > 0 ? `O indicador tem só R$ ${aPagar.toFixed(2).replace('.', ',')} a receber agora` : 'Não há nada a pagar a este indicador agora', VALOR_ACIMA_DO_LIBERADO)
        }
        return tx.inserir({ valor, data, forma: e.forma as FormaRepasse, obs, usuarioId: s.usuarioId })
      })
      await d.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'REPASSE_PAGO', entidade: 'indicador', entidadeId: id, depois: { repasseId: repasse.id, valor, forma: repasse.forma, data } })
      return { repasse, detalhe: await detalheDe(id) }
    },

    async jaPagos(s, indicadorId) {
      if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador vê os repasses de todos')
      return d.repo.listar({ indicadorId, limite: 200 })
    },
  }
}
