import type { Sessao } from '@/domain/escopo'
import { arred2 } from '@/domain/format'
import { calcularRepasse, type OperacaoRepasse } from '@/domain/repasseIndicador'
import { ErroApi } from './clientes'
import type { EmprestimosApi } from './emprestimos'
import type { IndicadoresApi } from './indicadores'
import { todasAsPaginas } from './paginar'
import type { DetalheRepasseApi, EntradaRepasse, FormaRepasse, RepasseApi, RepassesApi, ResumoDoIndicadorApi } from './repasses'
import type { VendasApi } from './vendas'

const FORMAS: FormaRepasse[] = ['PIX', 'DINHEIRO', 'TRANSFERENCIA']
const DATA = /^\d{4}-\d{2}-\d{2}$/
const dataValida = (v: unknown): v is string => typeof v === 'string' && DATA.test(v) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v

/**
 * Versão de demonstração: mesmas regras do backend. As operações vêm das vendas e dos empréstimos de mentira
 * (então um recebimento feito na demonstração libera repasse na hora).
 */
export function criarRepassesFake(d: { vendas: VendasApi; emprestimos: EmprestimosApi; indicadores: IndicadoresApi; hoje: string }): RepassesApi {
  const registros: RepasseApi[] = []
  let seq = 0
  const admin = (s: Sessao) => { if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Só o administrador vê os repasses de todos', 'SEM_PERMISSAO') }
  const ADM: Sessao = { perfil: 'ADMIN', usuarioId: 1 } // a demonstração lê as operações como administrador, e quem pode ver já foi checado acima

  async function operacoes(): Promise<Map<number, OperacaoRepasse[]>> {
    const mapa = new Map<number, OperacaoRepasse[]>()
    const pôr = (id: number, o: OperacaoRepasse) => mapa.set(id, [...(mapa.get(id) ?? []), o])
    for (const v of await todasAsPaginas((p) => d.vendas.listar(ADM, { pagina: p, limite: 100 }))) {
      if (!v.indicador) continue
      pôr(v.indicador.id, {
        tipo: 'VENDA', id: v.id, data: v.dataVenda, clienteNome: v.cliente.nome, descricao: `${v.aparelho.modelo} ${v.aparelho.gb} GB`, status: v.status as OperacaoRepasse['status'],
        pct: v.percentualIndicador ?? 0, investido: v.custoNoDia ?? 0, total: v.total, descontos: arred2(v.parcelas.reduce((x, p) => x + p.desconto, 0)), recebido: v.recebido,
      })
    }
    for (const e of await todasAsPaginas((p) => d.emprestimos.listar(ADM, { pagina: p, limite: 100 }))) {
      if (!e.indicador) continue
      pôr(e.indicador.id, {
        tipo: 'EMPRESTIMO', id: e.id, data: e.dataEmprestimo, clienteNome: e.cliente.nome, descricao: `Empréstimo ${e.modalidade === 'JUROS' ? 'só juros' : e.modalidade === 'DIARIA' ? 'diário' : 'parcelado'}`,
        status: e.status as OperacaoRepasse['status'], pct: e.percentualIndicador ?? 0, investido: e.capital ?? 0, total: e.total, descontos: arred2(e.parcelas.reduce((x, p) => x + p.desconto, 0)), recebido: e.recebido,
      })
    }
    return mapa
  }
  const pagoDe = (id: number) => arred2(registros.filter((r) => r.indicadorId === id).reduce((x, r) => x + r.valor, 0))
  const achar = async (s: Sessao, id: number) => (await d.indicadores.listar(s)).find((i) => i.id === id) ?? (() => { throw new ErroApi(404, 'Indicador não encontrado', 'NAO_ENCONTRADO') })()

  async function detalhe(s: Sessao, id: number): Promise<DetalheRepasseApi> {
    const ind = await achar(ADM, id)
    const { operacoes: ops, ...resumo } = calcularRepasse((await operacoes()).get(id) ?? [], pagoDe(id))
    return {
      indicador: { id: ind.id, nome: ind.nome, chavePix: ind.chavePix, ativo: ind.ativo }, resumo, nOperacoes: ops.length, operacoes: ops,
      repasses: registros.filter((r) => r.indicadorId === id).sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id),
    }
  }

  return {
    async resumo(s) {
      admin(s)
      const ops = await operacoes()
      const lista: ResumoDoIndicadorApi[] = []
      for (const i of await d.indicadores.listar(ADM)) {
        const { operacoes: o, ...resumo } = calcularRepasse(ops.get(i.id) ?? [], pagoDe(i.id))
        lista.push({ indicador: { id: i.id, nome: i.nome, chavePix: i.chavePix, ativo: i.ativo }, resumo, nOperacoes: o.length })
      }
      return lista
    },

    async detalhe(s, id) {
      if (s.perfil === 'INDICADOR') { if (s.indicadorId !== id) throw new ErroApi(404, 'Indicador não encontrado', 'NAO_ENCONTRADO') }
      else if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Você não tem acesso aos repasses', 'SEM_PERMISSAO')
      const d2 = await detalhe(s, id)
      // o capital (custo do aparelho / valor emprestado) é da loja: o indicador só vê o que é dele
      if (s.perfil === 'INDICADOR') return { ...d2, operacoes: d2.operacoes.map(({ investido: _investido, ...o }) => o) }
      return d2
    },

    async pagar(s, id, e: EntradaRepasse) {
      if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Só o administrador paga o repasse', 'SEM_PERMISSAO')
      if (typeof e.valor !== 'number' || !Number.isFinite(e.valor) || e.valor <= 0 || e.valor > 100_000_000) throw new ErroApi(400, 'valor precisa ser maior que zero')
      if (!FORMAS.includes(e.forma)) throw new ErroApi(400, 'forma deve ser PIX, DINHEIRO ou TRANSFERENCIA')
      let data = d.hoje
      if (e.data !== undefined) {
        if (!dataValida(e.data)) throw new ErroApi(400, 'data precisa ser uma data válida (AAAA-MM-DD)')
        if (e.data > d.hoje) throw new ErroApi(400, 'A data do repasse não pode ser no futuro')
        if (e.data < '2020-01-01') throw new ErroApi(400, 'A data do repasse é antiga demais')
        data = e.data
      }
      const obs = e.obs?.trim() || null
      if (obs && obs.length > 300) throw new ErroApi(400, 'obs: no máximo 300 letras')
      const ind = await achar(ADM, id)
      const valor = arred2(e.valor)
      const { aPagar } = calcularRepasse((await operacoes()).get(id) ?? [], pagoDe(id))
      if (valor > aPagar + 0.004) {
        throw new ErroApi(409, aPagar > 0 ? `O indicador tem só R$ ${aPagar.toFixed(2).replace('.', ',')} a receber agora` : 'Não há nada a pagar a este indicador agora', 'VALOR_ACIMA_DO_LIBERADO')
      }
      const repasse: RepasseApi = { id: ++seq, indicadorId: id, indicadorNome: ind.nome, valor, data, forma: e.forma, obs, feitoPor: 'Geovane Cataneo' }
      registros.push(repasse)
      return { repasse, detalhe: await detalhe(s, id) }
    },

    async jaPagos(s, indicadorId) {
      admin(s)
      return registros.filter((r) => !indicadorId || r.indicadorId === indicadorId).sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id)
    },
  }
}
