import type { Knex } from 'knex'
import { PAGO_PARCELA_EMPRESTIMO_SQL } from '../../../shared/sql.js'
import type { Emprestimo, EscopoEmprestimos, NovoEmprestimo, ParcelaEmprestimo } from './types.js'

/** Operações que precisam acontecer juntas, na mesma transação do banco. */
export interface EmprestimosTx {
  clienteExiste(id: number): Promise<{ id: number; nome: string } | null>
  indicadorAtivo(id: number): Promise<{ id: number; nome: string; pct: number } | null>
  criar(d: NovoEmprestimo): Promise<number>
  criarParcelas(emprestimoId: number, itens: { numero: number; vencimento: string; valor: number }[]): Promise<void>
}

export interface EmprestimosRepository {
  emTransacao<T>(fn: (tx: EmprestimosTx) => Promise<T>): Promise<T>
  /** Todos os empréstimos do escopo (com parcelas e quanto já foi pago), do mais novo para o mais antigo. */
  listar(escopo: EscopoEmprestimos): Promise<Emprestimo[]>
  buscar(id: number, escopo: EscopoEmprestimos): Promise<Emprestimo | null>
}

type Linha = {
  id: number; cliente_id: number; cliente_nome: string; indicador_id: number | null; indicador_nome: string | null; percentual_indicador: string
  data_emprestimo: Date | string; capital: string; modalidade: Emprestimo['modalidade']; taxa: string; periodicidade: Emprestimo['periodicidade']; status: Emprestimo['status']; observacoes: string | null; modo_divisao: Emprestimo['modoDivisao']
}
type LinhaParcela = { id: number; emprestimo_id: number; numero: number; vencimento: Date | string; vencimento_original: Date | string | null; valor: string; desconto: string; quitada_em: Date | string | null; pago: string; acordo_id: number | null; encerrada_acordo_id: number | null }

const dia = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)
const diaOuNull = (d: Date | string | null) => (d === null ? null : dia(d))

export function createEmprestimosRepository(db: Knex): EmprestimosRepository {
  function consulta(escopo: EscopoEmprestimos) {
    const q = db('emprestimos as e')
      .join('clientes as c', 'c.id', 'e.cliente_id')
      .leftJoin('indicadores as i', 'i.id', 'e.indicador_id')
      .select<Linha[]>('e.*', 'c.nome as cliente_nome', 'i.nome as indicador_nome')
    if (escopo.tipo === 'CARTEIRA') q.where('c.responsavel_id', escopo.usuarioId)
    else if (escopo.tipo === 'INDICADOR') q.where('e.indicador_id', escopo.indicadorId)
    return q
  }

  async function montar(linhas: Linha[]): Promise<Emprestimo[]> {
    if (!linhas.length) return []
    const ps = await db('emprestimo_parcelas as p')
      .whereIn('p.emprestimo_id', linhas.map((l) => l.id))
      .select<LinhaParcela[]>('p.*', db.raw(`${PAGO_PARCELA_EMPRESTIMO_SQL} as pago`))
      .orderBy(['p.emprestimo_id', 'p.numero'])
    // capital já amortizado por empréstimo (só juros): soma o excedente das transações não desfeitas, uma vez por transação
    const am = await db('transacoes_recebimento as t').whereNull('t.desfeita_em').whereNotNull('t.ajustes')
      .join(db('recebimentos as r').join('emprestimo_parcelas as p', 'p.id', 'r.emprestimo_parcela_id').whereIn('p.emprestimo_id', linhas.map((l) => l.id)).distinct('r.transacao_id', 'p.emprestimo_id').as('x'), 'x.transacao_id', 't.id')
      .groupBy('x.emprestimo_id').select<{ emprestimo_id: number; soma: string }[]>('x.emprestimo_id', db.raw("sum((t.ajustes->>'amortizacao')::numeric) as soma"))
    const amortizado = new Map(am.map((a) => [a.emprestimo_id, Number(a.soma)]))
    const porEmp = new Map<number, ParcelaEmprestimo[]>()
    for (const p of ps) {
      const lista = porEmp.get(p.emprestimo_id) ?? []
      lista.push({ id: p.id, numero: p.numero, vencimento: dia(p.vencimento), vencimentoOriginal: diaOuNull(p.vencimento_original), valor: Number(p.valor), desconto: Number(p.desconto), quitadaEm: diaOuNull(p.quitada_em), pago: Number(p.pago), acordo: p.encerrada_acordo_id ? 'ENCERRADA' : p.acordo_id ? 'NOVA' : null })
      porEmp.set(p.emprestimo_id, lista)
    }
    return linhas.map((l) => ({
      id: l.id, cliente: { id: l.cliente_id, nome: l.cliente_nome }, indicador: l.indicador_id ? { id: l.indicador_id, nome: l.indicador_nome ?? '' } : null,
      pct: Number(l.percentual_indicador), dataEmprestimo: dia(l.data_emprestimo), capital: Number(l.capital), modalidade: l.modalidade, taxa: Number(l.taxa), periodicidade: l.periodicidade, modoDivisao: l.modo_divisao,
      status: l.status, observacoes: l.observacoes, amortizado: amortizado.get(l.id) ?? 0, parcelas: porEmp.get(l.id) ?? [],
    }))
  }

  return {
    async listar(escopo) {
      return montar(await consulta(escopo).orderBy([{ column: 'e.data_emprestimo', order: 'desc' }, { column: 'e.id', order: 'desc' }]))
    },
    async buscar(id, escopo) {
      const l = await consulta(escopo).where('e.id', id).first()
      return l ? (await montar([l]))[0] : null
    },

    async emTransacao(fn) {
      return db.transaction(async (trx) => {
        const tx: EmprestimosTx = {
          async clienteExiste(id) {
            return (await trx('clientes').where({ id }).first<{ id: number; nome: string } | undefined>('id', 'nome')) ?? null
          },
          async indicadorAtivo(id) {
            const l = await trx('indicadores').where({ id, ativo: true }).first<{ id: number; nome: string; pct: string } | undefined>('id', 'nome', 'pct')
            return l ? { id: l.id, nome: l.nome, pct: Number(l.pct) } : null
          },
          async criar(d) {
            const [{ id }] = await trx('emprestimos').insert({
              cliente_id: d.clienteId, indicador_id: d.indicadorId, percentual_indicador: d.pct, data_emprestimo: d.dataEmprestimo,
              capital: d.capital, modalidade: d.modalidade, taxa: d.taxa, periodicidade: d.periodicidade, observacoes: d.observacoes, modo_divisao: d.modoDivisao,
            }).returning('id')
            return id
          },
          async criarParcelas(emprestimoId, itens) {
            if (itens.length) await trx('emprestimo_parcelas').insert(itens.map((p) => ({ emprestimo_id: emprestimoId, numero: p.numero, vencimento: p.vencimento, valor: p.valor })))
          },
        }
        return fn(tx)
      })
    },
  }
}
