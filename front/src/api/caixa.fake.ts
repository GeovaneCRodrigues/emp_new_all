import { casaBusca } from '@/domain/busca'
import { nomeEmprestimo } from '@/domain/emprestimo'
import type { Sessao } from '@/domain/escopo'
import { arred2 } from '@/domain/format'
import { todasAsPaginas } from './paginar'
import { ErroApi } from './clientes'
import type { CaixaApi, CaixaLojaApi, EntradaLancamento, LancamentoApi, MovimentoApi, TipoLancamento } from './caixa'
import type { EmprestimosFake } from './emprestimos.fake'
import type { EstoqueApi } from './estoque'
import type { RepassesApi } from './repasses'
import type { VendasFake } from './vendas.fake'

const ADM: Sessao = { perfil: 'ADMIN', usuarioId: 1 }
const TIPOS: TipoLancamento[] = ['APORTE', 'RETIRADA', 'DESPESA']
const DINHEIRO_MAX = 1_000_000_000
const LIMITE_MAX = 100
const erro = (m: string) => new ErroApi(400, m)
const FORMA = { PIX: 'Pix', DINHEIRO: 'dinheiro', CARTAO: 'cartão' } as const
const ROTULO: Record<TipoLancamento, string> = { APORTE: 'Aporte', RETIRADA: 'Retirada', DESPESA: 'Despesa' }

function diaValido(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw erro('data precisa ser AAAA-MM-DD')
  if (new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) !== v) throw erro('data inválida')
  if (v < '2000-01-01') throw erro('data muito antiga')
  return v
}

/**
 * Versão de demonstração: as mesmas regras do backend. Junta o que a demonstração já tem (recebimentos, empréstimos,
 * compras de aparelho, repasses) com os lançamentos manuais, e só conta a partir do primeiro aporte ou retirada.
 */
export function criarCaixaFake(dep: { vendas: VendasFake; emprestimos: EmprestimosFake; estoque: EstoqueApi; repasses: RepassesApi }): CaixaApi {
  const hoje = dep.vendas._interno.hoje
  let seq = 1
  // a demonstração começa com o saldo de abertura, como o dono faria
  const manuais: LancamentoApi[] = [{ id: seq++, tipo: 'APORTE', valor: 100000, data: '2026-01-01', obs: 'Saldo de abertura' }]
  const exigirAdmin = (s: Sessao) => { if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Só o administrador mexe no caixa da loja', 'SEM_PERMISSAO') }

  function ler(corpo: Partial<EntradaLancamento>, base: LancamentoApi | null) {
    const tipo = corpo.tipo !== undefined || !base ? corpo.tipo : base.tipo
    if (typeof tipo !== 'string' || !TIPOS.includes(tipo)) throw erro('tipo precisa ser APORTE, RETIRADA ou DESPESA')
    const v = corpo.valor !== undefined || !base ? corpo.valor : base.valor
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > DINHEIRO_MAX) throw erro('valor precisa ser maior que zero')
    const data = corpo.data !== undefined || !base ? (corpo.data === undefined ? hoje : diaValido(corpo.data)) : base.data
    if (data > hoje) throw erro('A data não pode ser no futuro')
    const bruta = corpo.obs !== undefined ? corpo.obs : base?.obs ?? null
    if (bruta !== null && typeof bruta !== 'string') throw erro('obs precisa ser texto')
    const obs = bruta?.trim() || null
    if (obs && obs.length > 200) throw erro('obs: no máximo 200 letras')
    if (tipo === 'DESPESA' && !obs) throw erro('Diga com o que foi a despesa')
    return { tipo, valor: arred2(v), data, obs }
  }

  async function movimentos(): Promise<{ lista: MovimentoApi[]; marcoZero: string | null }> {
    const m: MovimentoApi[] = []
    const reg = dep.vendas._interno.registros
    for (const t of dep.vendas._interno.transacoes) {
      if (t.desfeita || t.data > hoje) continue
      const entrada = t.tipo === 'ENTRADA'
      const venda = t.alvo === 'VENDA' ? reg.find((r) => r.id === t.operacaoId) : undefined
      const emp = t.alvo === 'EMPRESTIMO' ? dep.emprestimos._interno.registros.find((r) => r.id === t.operacaoId) : undefined
      const descricao = venda ? venda.aparelho.modelo : emp ? nomeEmprestimo(emp.modalidade, emp.periodicidade) : ''
      m.push({ chave: 'R' + t.id, data: t.data, valor: t.valor, entrada: true, categoria: entrada ? 'ENTRADA_VENDA' : 'RECEBIMENTO', titulo: entrada ? `Entrada · ${t.clienteNome}` : t.clienteNome, sub: [descricao, entrada ? '' : t.resumo?.referencia ?? '', FORMA[t.forma]].filter(Boolean).join(' · '), manualId: null })
    }
    for (const r of dep.emprestimos._interno.registros) {
      if (r.status === 'CANCELADA' || r.dataEmprestimo > hoje) continue
      m.push({ chave: 'E' + r.id, data: r.dataEmprestimo, valor: r.capital, entrada: false, categoria: 'EMPRESTIMO', titulo: `Empréstimo liberado · ${r.cliente.nome}`, sub: nomeEmprestimo(r.modalidade, r.periodicidade), manualId: null })
    }
    for (const a of await todasAsPaginas((p) => dep.estoque.listar(ADM, { pagina: p, limite: 100 }))) {
      const custo = arred2((a.custo ?? 0) + (a.extras ?? 0))
      if (a.origem !== 'COMPRA' || a.estado === 'ENCOMENDADO' || custo <= 0 || a.dataCompra > hoje) continue
      m.push({ chave: 'B' + a.id, data: a.dataCompra, valor: custo, entrada: false, categoria: 'COMPRA', titulo: `Compra · ${a.modelo}${a.gb > 0 ? ` ${a.gb} GB` : ''}`, sub: a.cor === 'A DEFINIR' ? '' : a.cor, manualId: null })
    }
    for (const r of await dep.repasses.jaPagos(ADM)) {
      if (r.data > hoje) continue
      m.push({ chave: 'P' + r.id, data: r.data, valor: r.valor, entrada: false, categoria: 'REPASSE', titulo: `Repasse · ${r.indicadorNome}`, sub: 'parte do lucro', manualId: null })
    }
    for (const x of manuais) {
      if (x.data > hoje) continue
      m.push({ chave: 'M' + x.id, data: x.data, valor: x.valor, entrada: x.tipo === 'APORTE', categoria: x.tipo, titulo: x.obs ?? ROTULO[x.tipo], sub: ROTULO[x.tipo], manualId: x.id })
    }
    const datas = manuais.filter((x) => x.tipo !== 'DESPESA').map((x) => x.data).sort()
    const marcoZero = datas[0] ?? null
    return { lista: m.filter((x) => !marcoZero || x.data >= marcoZero).sort((a, b) => b.data.localeCompare(a.data) || (a.chave < b.chave ? 1 : a.chave > b.chave ? -1 : 0)), marcoZero }
  }

  return {
    async ver(s, q = {}): Promise<CaixaLojaApi> {
      exigirAdmin(s)
      const limite = Math.min(Math.max(Math.trunc(q.limite ?? 25) || 25, 1), LIMITE_MAX)
      const pagina = Math.max(Math.trunc(q.pagina ?? 1) || 1, 1)
      const { lista: todos, marcoZero } = await movimentos()
      // o saldo e o resumo do mês são sempre os de tudo; a busca só filtra o extrato
      const lista = todos
      const achados = todos.filter((x) => casaBusca([x.titulo, x.sub], q.busca))
      const mes = hoje.slice(0, 7)
      const doMes = lista.filter((x) => x.data.slice(0, 7) === mes)
      const soma = (xs: MovimentoApi[]) => arred2(xs.reduce((t, x) => t + x.valor, 0))
      return {
        saldo: arred2(lista.reduce((t, x) => t + (x.entrada ? x.valor : -x.valor), 0)), marcoZero, entrouMes: soma(doMes.filter((x) => x.entrada)), saiuMes: soma(doMes.filter((x) => !x.entrada)),
        hoje, mes, itens: achados.slice((pagina - 1) * limite, pagina * limite), total: achados.length, pagina, limite,
      }
    },
    async lancar(s, e) {
      exigirAdmin(s)
      const l: LancamentoApi = { id: seq++, ...ler(e, null) }
      manuais.push(l)
      return { ...l }
    },
    async editar(s, id, e) {
      exigirAdmin(s)
      const i = manuais.findIndex((x) => x.id === id)
      if (i < 0) throw new ErroApi(404, 'Lançamento não encontrado (só aporte, retirada e despesa se editam)', 'NAO_ENCONTRADO')
      manuais[i] = { id, ...ler(e, manuais[i]) }
      return { ...manuais[i] }
    },
    async excluir(s, id) {
      exigirAdmin(s)
      const i = manuais.findIndex((x) => x.id === id)
      if (i < 0) throw new ErroApi(404, 'Lançamento não encontrado (só aporte, retirada e despesa se excluem)', 'NAO_ENCONTRADO')
      manuais.splice(i, 1)
    },
  }
}
