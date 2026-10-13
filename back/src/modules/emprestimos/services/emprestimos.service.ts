import { addDia } from '../../../shared/datas.js'
import { naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import type { Sessao } from '../../../shared/perfis.js'
import { hojeBR } from '../../../shared/relogio.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import { arred2 } from '../../vendas/services/calculo.js'
import { contas } from '../../vendas/services/contas.js'
import type { EmprestimosRepository } from '../models/repository.js'
import type { Emprestimo, EscopoEmprestimos, ModalidadeEmprestimo, ModoDivisao, Periodicidade } from '../models/types.js'
import { planoEmprestimo, primeiroVencimentoPadrao, totalDoPlano } from './calculo.js'

export type Entrada = Record<string, unknown>
export type EmprestimoCalculado = { emprestimo: Emprestimo } & ReturnType<typeof contas>
export type FiltroEmprestimos = { status?: string; pagina?: number; limite?: number }
export type ResultadoLista = { itens: EmprestimoCalculado[]; total: number; pagina: number; limite: number }
export type ResumoEmprestimos = { aReceber: number; capitalNaRua: number; lucroPorVir: number }

export type EmprestimosService = {
  criar(s: Sessao, e: Entrada): Promise<EmprestimoCalculado>
  listar(s: Sessao, f: FiltroEmprestimos): Promise<ResultadoLista>
  obter(s: Sessao, id: number): Promise<EmprestimoCalculado>
  resumo(s: Sessao): Promise<ResumoEmprestimos>
}

/** Modalidades já liberadas. As outras entram uma de cada vez. */
export const MODALIDADES_LIBERADAS: ModalidadeEmprestimo[] = ['PARCELADO', 'JUROS', 'DIARIA']
const TODAS: ModalidadeEmprestimo[] = ['PARCELADO', 'JUROS', 'DIARIA']
const PERIODICIDADES: Periodicidade[] = ['MENSAL', 'QUINZENAL', 'SEMANAL', 'DIARIA']
const DATA = /^\d{4}-\d{2}-\d{2}$/
const dataValida = (v: unknown): v is string => typeof v === 'string' && DATA.test(v) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v
const LIMITE_MAX = 100
const DINHEIRO_MAX = 100_000_000

export function escopoDe(s: Sessao): EscopoEmprestimos {
  if (s.perfil === 'ADMIN') return { tipo: 'TODOS' }
  if (s.perfil === 'COBRADOR') return { tipo: 'CARTEIRA', usuarioId: s.usuarioId }
  if (s.perfil === 'INDICADOR') return { tipo: 'INDICADOR', indicadorId: s.indicadorId ?? -1 }
  throw semPermissao('Você não tem acesso aos empréstimos')
}

const inteiro = (v: unknown, campo: string, min: number, max: number) => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw requisicaoInvalida(`${campo} precisa ser um número inteiro entre ${min} e ${max}`)
  return v
}

export type Dependencias = {
  emprestimos: EmprestimosRepository
  auditoria: AuditoriaRepository
  /** Depois de emprestar, o indicador pode ter subido de nível. */
  sincronizarNiveis?: () => Promise<void>
  hoje?: () => string
  log?: (msg: string, err: unknown) => void
}

export function createEmprestimosService(d: Dependencias): EmprestimosService {
  const hoje = d.hoje ?? (() => hojeBR())
  const calcular = (e: Emprestimo): EmprestimoCalculado => ({
    emprestimo: e,
    ...contas({ entrada: e.amortizado, troca: 0, investido: e.capital, pct: e.pct, statusGravado: e.status, parcelas: e.parcelas.map((p) => ({ valor: p.valor, desconto: p.desconto, pago: p.pago, vencimento: p.vencimento })) }, hoje()),
  })

  return {
    async criar(s, e) {
      if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador faz empréstimos')
      const clienteId = inteiro(e.clienteId, 'clienteId', 1, 2 ** 31 - 1)
      if (typeof e.modalidade !== 'string' || !TODAS.includes(e.modalidade as ModalidadeEmprestimo)) throw requisicaoInvalida('modalidade deve ser PARCELADO, JUROS ou DIARIA')
      const modalidade = e.modalidade as ModalidadeEmprestimo
      if (!MODALIDADES_LIBERADAS.includes(modalidade)) throw requisicaoInvalida('Esta modalidade ainda não está disponível')
      if (typeof e.capital !== 'number' || !Number.isFinite(e.capital) || e.capital <= 0 || e.capital > DINHEIRO_MAX) throw requisicaoInvalida('capital precisa ser maior que zero')
      const taxaMax = modalidade === 'JUROS' ? 100 : 999
      if (typeof e.taxa !== 'number' || !Number.isFinite(e.taxa) || e.taxa <= 0 || e.taxa > taxaMax) {
        throw requisicaoInvalida(modalidade === 'JUROS' ? 'taxa precisa ficar entre 0 e 100 (% a cada parcela)' : 'taxa precisa ficar entre 0 e 999 (% de juros no total)')
      }
      const taxa = Math.round(e.taxa * 1e4) / 1e4
      const n = inteiro(e.parcelas, 'parcelas', 1, 120)
      // diária é a modalidade DIARIA com frequência diária; as outras frequências são só do parcelado e do só juros
      const periodicidade = (e.periodicidade === undefined || e.periodicidade === null ? (modalidade === 'DIARIA' ? 'DIARIA' : 'MENSAL') : e.periodicidade) as Periodicidade
      if (!PERIODICIDADES.includes(periodicidade)) throw requisicaoInvalida('periodicidade deve ser MENSAL, QUINZENAL, SEMANAL ou DIARIA')
      if ((modalidade === 'DIARIA') !== (periodicidade === 'DIARIA')) throw requisicaoInvalida(modalidade === 'DIARIA' ? 'A diária cobra todo dia útil: não combina com outra frequência' : 'Para cobrar todo dia use a modalidade DIARIA')
      const dia = hoje()
      let data = dia
      if (e.dataEmprestimo !== undefined && e.dataEmprestimo !== null) {
        if (!dataValida(e.dataEmprestimo)) throw requisicaoInvalida('dataEmprestimo precisa ser uma data válida (AAAA-MM-DD)')
        if (e.dataEmprestimo > dia) throw requisicaoInvalida('A data do empréstimo não pode ser no futuro')
        if (e.dataEmprestimo < '2020-01-01') throw requisicaoInvalida('A data do empréstimo é antiga demais')
        data = e.dataEmprestimo
      }
      let primeira = primeiroVencimentoPadrao(data, periodicidade)
      if (e.primeiroVencimento !== undefined && e.primeiroVencimento !== null) {
        if (!dataValida(e.primeiroVencimento)) throw requisicaoInvalida('primeiroVencimento precisa ser uma data válida (AAAA-MM-DD)')
        if (e.primeiroVencimento < data) throw requisicaoInvalida('O 1º vencimento não pode ser antes da data do empréstimo')
        if (e.primeiroVencimento > addDia(data, 366)) throw requisicaoInvalida('O 1º vencimento não pode passar de um ano depois do empréstimo')
        primeira = e.primeiroVencimento
      }
      const indicadorId = e.indicadorId === undefined || e.indicadorId === null ? null : inteiro(e.indicadorId, 'indicadorId', 1, 2 ** 31 - 1)
      let modoDivisao: ModoDivisao = 'CAPITAL_PRIMEIRO'
      if (e.modoDivisao !== undefined && e.modoDivisao !== null) {
        if (e.modoDivisao !== 'CAPITAL_PRIMEIRO' && e.modoDivisao !== 'JUROS_MENSAL') throw requisicaoInvalida('modoDivisao deve ser CAPITAL_PRIMEIRO ou JUROS_MENSAL')
        if (e.modoDivisao === 'JUROS_MENSAL' && (modalidade !== 'JUROS' || indicadorId === null)) throw requisicaoInvalida('Dividir a cada pagamento só vale para empréstimo só juros com indicador')
        modoDivisao = e.modoDivisao
      }
      let observacoes: string | null = null
      if (e.observacoes !== undefined && e.observacoes !== null && e.observacoes !== '') {
        if (typeof e.observacoes !== 'string' || e.observacoes.trim().length > 500) throw requisicaoInvalida('observações: no máximo 500 letras')
        observacoes = e.observacoes.trim()
      }
      const capital = arred2(e.capital)

      const id = await d.emprestimos.emTransacao(async (tx) => {
        const cliente = await tx.clienteExiste(clienteId)
        if (!cliente) throw naoEncontrado('Cliente não encontrado')
        let indicador: { id: number; nome: string; pct: number } | null = null
        if (indicadorId !== null) {
          indicador = await tx.indicadorAtivo(indicadorId)
          if (!indicador) throw requisicaoInvalida('Indicador não encontrado ou desativado')
        }
        const id = await tx.criar({
          clienteId: cliente.id, indicadorId: indicador?.id ?? null,
          // o % do indicador fica congelado neste empréstimo
          pct: indicador?.pct ?? 0, dataEmprestimo: data, capital, modalidade, taxa, periodicidade, observacoes, modoDivisao,
        })
        await tx.criarParcelas(id, planoEmprestimo({ capital, modalidade, taxa, n, data, periodicidade, primeira }).map((p, i) => ({ numero: i + 1, ...p })))
        return id
      })

      const emp = (await d.emprestimos.buscar(id, { tipo: 'TODOS' }))!
      const calc = calcular(emp)
      await d.auditoria.registrar({
        usuarioId: s.usuarioId, acao: 'EMPRESTIMO_CRIADO', entidade: 'emprestimo', entidadeId: id,
        depois: { clienteId: emp.cliente.id, indicadorId: emp.indicador?.id ?? null, pct: emp.pct, capital, modalidade, taxa: emp.taxa, periodicidade, dataEmprestimo: data, modoDivisao, primeiroVencimento: emp.parcelas[0]?.vencimento ?? null, parcelas: emp.parcelas.length, total: calc.total },
      })
      await d.sincronizarNiveis?.().catch((err) => d.log?.('Falha ao sincronizar os níveis dos indicadores', err))
      return calc
    },

    async listar(s, f) {
      const escopo = escopoDe(s)
      const limite = Math.min(Math.max(Math.trunc(f.limite ?? 20) || 20, 1), LIMITE_MAX)
      const pagina = Math.max(Math.trunc(f.pagina ?? 1) || 1, 1)
      if (f.status && !['ATIVA', 'ATRASO', 'QUITADA'].includes(f.status)) throw requisicaoInvalida('status inválido')
      const filtradas = (await d.emprestimos.listar(escopo)).map(calcular).filter((c) => {
        if (!f.status) return true
        if (f.status === 'ATRASO') return c.status === 'ATIVA' && c.atrasadas > 0
        return c.status === f.status
      })
      return { itens: filtradas.slice((pagina - 1) * limite, pagina * limite), total: filtradas.length, pagina, limite }
    },

    async obter(s, id) {
      const e = await d.emprestimos.buscar(id, escopoDe(s))
      if (!e) throw naoEncontrado('Empréstimo não encontrado')
      return calcular(e)
    },

    async resumo(s) {
      const ativos = (await d.emprestimos.listar(escopoDe(s))).map(calcular).filter((c) => c.status === 'ATIVA')
      return {
        aReceber: arred2(ativos.reduce((x, c) => x + c.falta, 0)),
        capitalNaRua: arred2(ativos.reduce((x, c) => x + (c.emprestimo.capital - c.capitalDeVolta), 0)),
        lucroPorVir: arred2(ativos.reduce((x, c) => x + Math.max(0, c.seuLucro - c.lucroRealizado), 0)),
      }
    },
  }
}

export { totalDoPlano }
