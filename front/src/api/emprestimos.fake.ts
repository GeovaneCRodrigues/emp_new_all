import { criarSeed } from '@/data/seed'
import { planoEmprestimo } from '@/domain/calc'
import { addDia } from '@/domain/datas'
import type { Sessao } from '@/domain/escopo'
import { arred2 } from '@/domain/format'
import { partesDoIndicador } from '@/domain/repasseIndicador'
import { ErroApi, type ClientesApi } from './clientes'
import { MODALIDADES_LIBERADAS, type EmprestimoApi, type EmprestimosApi, type EntradaEmprestimo, type ModalidadeApi, type PeriodicidadeApi, type StatusEmprestimo } from './emprestimos'
import type { IndicadoresFake } from './indicadores.fake'

export interface Parcela { numero: number; vencimento: string; vencimentoOriginal: string | null; valor: number; desconto: number; pago: number; quitadaEm: string | null; /** criada por um acordo */ acordoId?: number | null; /** encerrada por um acordo */ encerradaId?: number | null }
export interface RegistroEmprestimo {
  id: number; cliente: { id: number; nome: string }; indicador: { id: number; nome: string } | null; pct: number; dataEmprestimo: string
  capital: number; modalidade: ModalidadeApi; taxa: number; periodicidade: PeriodicidadeApi; status: StatusEmprestimo; observacoes: string | null
  /** só juros: quanto do capital já foi pago adiantado (conta como dinheiro recebido) */
  amortizado: number; parcelas: Parcela[]
}

export interface EmprestimosFake extends EmprestimosApi {
  _interno: { hoje: string; registros: RegistroEmprestimo[]; noEscopo(s: Sessao): RegistroEmprestimo[]; calcular(r: RegistroEmprestimo, perfil: Sessao['perfil']): EmprestimoApi }
}

const TODAS: ModalidadeApi[] = ['PARCELADO', 'JUROS', 'DIARIA']
const PERIODICIDADES: PeriodicidadeApi[] = ['MENSAL', 'QUINZENAL', 'SEMANAL', 'DIARIA']
const dataValida = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v
const erro = (m: string) => new ErroApi(400, m)
const inteiro = (v: unknown, c: string, min: number, max: number) => { if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw erro(`${c} precisa ser um número inteiro entre ${min} e ${max}`); return v }

/**
 * Versão de demonstração: mesmas regras do backend (só o admin empresta, o cobrador só vê a carteira dele e
 * sem capital/taxa/lucro, % do indicador congelado, o servidor refaz as parcelas).
 */
export function criarEmprestimosFake(dep: { clientes: ClientesApi; indicadores: IndicadoresFake }): EmprestimosFake {
  const seed = criarSeed()
  const hoje = seed.hoje
  let proximoId = 1000

  const registros: RegistroEmprestimo[] = seed.emprestimos.map((e) => {
    const cli = seed.clientes.find((c) => c.id === e.clienteId)!
    const ind = seed.indicadores.find((i) => i.id === e.indicadorId)
    return {
      id: e.id, cliente: { id: cli.id, nome: cli.nome }, indicador: ind ? { id: ind.id, nome: ind.nome } : null, pct: e.pct, dataEmprestimo: e.data,
      capital: e.capital, modalidade: e.mod, taxa: e.taxa, periodicidade: e.freq, status: e.status === 'QUITADA' ? 'QUITADA' : 'ATIVA', observacoes: null, amortizado: 0,
      parcelas: e.parcelas.map((p) => ({ numero: p.n, vencimento: p.venc, vencimentoOriginal: p.vencOriginal ?? null, valor: p.valor, desconto: p.desconto, pago: p.pagos.reduce((x, g) => x + g.valor, 0), quitadaEm: p.pago })),
    }
  })

  const responsavel = (clienteId: number) => seed.clientes.find((c) => c.id === clienteId)?.responsavelId
  // o indicador só enxerga (e só lê) os empréstimos que ele indicou
  const noEscopo = (s: Sessao) => (s.perfil === 'ADMIN' ? registros : s.perfil === 'INDICADOR' ? registros.filter((r) => r.indicador?.id === s.indicadorId) : registros.filter((r) => responsavel(r.cliente.id) === s.usuarioId))
  const acesso = (s: Sessao) => { if (s.perfil !== 'ADMIN' && s.perfil !== 'COBRADOR' && s.perfil !== 'INDICADOR') throw new ErroApi(403, 'Você não tem acesso aos empréstimos', 'SEM_PERMISSAO') }

  function calcular(r: RegistroEmprestimo, perfil: Sessao['perfil']): EmprestimoApi {
    const total = arred2(r.amortizado + r.parcelas.reduce((x, p) => x + p.valor, 0))
    const recebido = arred2(r.amortizado + r.parcelas.reduce((x, p) => x + p.pago, 0))
    const descontos = arred2(r.parcelas.reduce((x, p) => x + p.desconto, 0))
    const falta = arred2(total - recebido - descontos)
    const abertas = r.parcelas.filter((p) => arred2(p.valor - p.pago - p.desconto) > 0.009)
    const lucroTotal = arred2(total - r.capital)
    const status: StatusEmprestimo = r.status === 'CANCELADA' ? 'CANCELADA' : falta <= 0.009 ? 'QUITADA' : 'ATIVA'
    const base: EmprestimoApi = {
      id: r.id, cliente: r.cliente, modalidade: r.modalidade, periodicidade: r.periodicidade, dataEmprestimo: r.dataEmprestimo, observacoes: r.observacoes, nParcelas: r.parcelas.length,
      valorParcela: r.parcelas[0]?.valor ?? 0, total, recebido, falta, atrasadas: abertas.filter((p) => p.vencimento < hoje).length, status,
      parcelas: r.parcelas.map((p) => ({ numero: p.numero, vencimento: p.vencimento, vencimentoOriginal: p.vencimentoOriginal, valor: p.valor, desconto: p.desconto, pago: p.pago, falta: arred2(p.valor - p.pago - p.desconto), quitadaEm: p.quitadaEm, acordo: p.encerradaId ? 'ENCERRADA' : p.acordoId ? 'NOVA' : null })),
    }
    // o indicador vê a parte dele (prevista e já liberada), nunca capital, taxa nem lucro da loja
    if (perfil === 'INDICADOR') {
      const { parte, liberado } = partesDoIndicador({ total, descontos, recebido, investido: r.capital, pct: r.pct })
      return { ...base, percentualIndicador: r.pct, suaParte: parte, jaLiberado: liberado }
    }
    if (perfil !== 'ADMIN') return base
    return {
      ...base, indicador: r.indicador, capital: r.capital, taxa: r.taxa, capitalAberto: arred2(r.capital - r.amortizado), lucroTotal, capitalDeVolta: arred2(Math.min(r.capital, recebido)),
      lucroRealizado: arred2(Math.max(0, recebido - r.capital) * (1 - r.pct)), seuLucro: arred2(lucroTotal > 0 ? lucroTotal * (1 - r.pct) : lucroTotal),
      percentualIndicador: r.pct, parteIndicador: arred2(lucroTotal > 0 ? lucroTotal * r.pct : 0),
    }
  }

  return {
    _interno: { hoje, registros, noEscopo, calcular },

    async criar(s, e: EntradaEmprestimo) {
      if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Só o administrador faz empréstimos', 'SEM_PERMISSAO')
      const clienteId = inteiro(e.clienteId, 'clienteId', 1, 2 ** 31 - 1)
      if (typeof e.modalidade !== 'string' || !TODAS.includes(e.modalidade)) throw erro('modalidade deve ser PARCELADO, JUROS ou DIARIA')
      if (!MODALIDADES_LIBERADAS.includes(e.modalidade)) throw erro('Esta modalidade ainda não está disponível')
      if (typeof e.capital !== 'number' || !Number.isFinite(e.capital) || e.capital <= 0 || e.capital > 1e8) throw erro('capital precisa ser maior que zero')
      const taxaMax = e.modalidade === 'JUROS' ? 100 : 999
      if (typeof e.taxa !== 'number' || !Number.isFinite(e.taxa) || e.taxa <= 0 || e.taxa > taxaMax) {
        throw erro(e.modalidade === 'JUROS' ? 'taxa precisa ficar entre 0 e 100 (% a cada parcela)' : 'taxa precisa ficar entre 0 e 999 (% de juros no total)')
      }
      const taxa = Math.round(e.taxa * 1e4) / 1e4
      const n = inteiro(e.parcelas, 'parcelas', 1, 120)
      const periodicidade = (e.periodicidade === undefined || e.periodicidade === null ? (e.modalidade === 'DIARIA' ? 'DIARIA' : 'MENSAL') : e.periodicidade) as PeriodicidadeApi
      if (!PERIODICIDADES.includes(periodicidade)) throw erro('periodicidade deve ser MENSAL, QUINZENAL, SEMANAL ou DIARIA')
      if ((e.modalidade === 'DIARIA') !== (periodicidade === 'DIARIA')) throw erro(e.modalidade === 'DIARIA' ? 'A diária cobra todo dia útil: não combina com outra frequência' : 'Para cobrar todo dia use a modalidade DIARIA')
      let data = hoje
      if (e.dataEmprestimo !== undefined && e.dataEmprestimo !== null) {
        if (!dataValida(e.dataEmprestimo)) throw erro('dataEmprestimo precisa ser uma data válida (AAAA-MM-DD)')
        if (e.dataEmprestimo > hoje) throw erro('A data do empréstimo não pode ser no futuro')
        if (e.dataEmprestimo < '2020-01-01') throw erro('A data do empréstimo é antiga demais')
        data = e.dataEmprestimo
      }
      let primeira: string | undefined
      if (e.primeiroVencimento !== undefined && e.primeiroVencimento !== null) {
        if (!dataValida(e.primeiroVencimento)) throw erro('primeiroVencimento precisa ser uma data válida (AAAA-MM-DD)')
        if (e.primeiroVencimento < data) throw erro('O 1º vencimento não pode ser antes da data do empréstimo')
        if (e.primeiroVencimento > addDia(data, 366)) throw erro('O 1º vencimento não pode passar de um ano depois do empréstimo')
        primeira = e.primeiroVencimento
      }
      const indicadorId = e.indicadorId === undefined || e.indicadorId === null ? null : inteiro(e.indicadorId, 'indicadorId', 1, 2 ** 31 - 1)
      let observacoes: string | null = null
      if (e.observacoes !== undefined && e.observacoes !== null && e.observacoes !== '') {
        if (typeof e.observacoes !== 'string' || e.observacoes.trim().length > 500) throw erro('observações: no máximo 500 letras')
        observacoes = e.observacoes.trim()
      }
      const cliente = await dep.clientes.obter(s, clienteId).catch(() => null)
      if (!cliente) throw new ErroApi(404, 'Cliente não encontrado', 'NAO_ENCONTRADO')
      let indicador: { id: number; nome: string; pct: number } | null = null
      if (indicadorId !== null) {
        indicador = dep.indicadores._interno.ativo(indicadorId)
        if (!indicador) throw erro('Indicador não encontrado ou desativado')
      }
      const capital = arred2(e.capital)
      const reg: RegistroEmprestimo = {
        id: ++proximoId, cliente: { id: cliente.id, nome: cliente.nome }, indicador: indicador ? { id: indicador.id, nome: indicador.nome } : null, pct: indicador?.pct ?? 0,
        dataEmprestimo: data, capital, modalidade: e.modalidade, taxa, periodicidade, status: 'ATIVA', observacoes, amortizado: 0,
        parcelas: planoEmprestimo({ capital, mod: e.modalidade, taxa, n, data, freq: periodicidade, primeira }).map((p, i) => ({ numero: i + 1, vencimento: p.venc, vencimentoOriginal: null, valor: p.valor, desconto: 0, pago: 0, quitadaEm: null })),
      }
      registros.push(reg)
      if (indicador) dep.indicadores._interno.contarOperacao(indicador.id)
      return calcular(reg, s.perfil)
    },

    async listar(s, q) {
      acesso(s)
      if (q.status && !['ATIVA', 'ATRASO', 'QUITADA'].includes(q.status)) throw erro('status inválido')
      const limite = Math.min(Math.max(q.limite ?? 20, 1), 100)
      const pagina = Math.max(q.pagina ?? 1, 1)
      const todos = noEscopo(s).map((r) => calcular(r, s.perfil)).sort((a, b) => b.dataEmprestimo.localeCompare(a.dataEmprestimo) || b.id - a.id)
        .filter((c) => !q.status || (q.status === 'ATRASO' ? c.status === 'ATIVA' && c.atrasadas > 0 : c.status === q.status))
      return { itens: todos.slice((pagina - 1) * limite, pagina * limite), total: todos.length, pagina, limite }
    },

    async obter(s, id) {
      acesso(s)
      const r = noEscopo(s).find((x) => x.id === id)
      if (!r) throw new ErroApi(404, 'Empréstimo não encontrado', 'NAO_ENCONTRADO')
      return calcular(r, s.perfil)
    },

    async resumo(s) {
      acesso(s)
      const ativos = noEscopo(s).map((r) => calcular(r, 'ADMIN')).filter((c) => c.status === 'ATIVA')
      const aReceber = arred2(ativos.reduce((x, c) => x + c.falta, 0))
      if (s.perfil !== 'ADMIN') return { aReceber }
      return {
        aReceber, capitalNaRua: arred2(ativos.reduce((x, c) => x + ((c.capital ?? 0) - (c.capitalDeVolta ?? 0)), 0)),
        lucroPorVir: arred2(ativos.reduce((x, c) => x + Math.max(0, (c.seuLucro ?? 0) - (c.lucroRealizado ?? 0)), 0)),
      }
    },
  }
}
