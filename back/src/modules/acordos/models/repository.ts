import type { Knex } from 'knex'
import { naoEncontrado } from '../../../shared/errors.js'
import { fazerAcordo, type AlvoAcordo, type ResultadoAcordo } from './acordo.js'

export type AcordoRegistro = {
  id: number
  dataAcordo: string
  saldoAntes: number
  valorTotal: number
  nParcelas: number
  primeiraParcela: string
  motivo: string | null
  status: 'ATIVO' | 'SUBSTITUIDO'
  feitoPor: string | null
  /** o pedido do cobrador que originou o acordo, se foi o caso */
  aprovacaoId: number | null
}

export type EscopoAcordos = { tipo: 'TODOS' } | { tipo: 'CARTEIRA'; usuarioId: number }

export interface AcordosRepository {
  /** Trava a operação e faz o acordo numa transação só. */
  fazer(d: { alvo: AlvoAcordo; operacaoId: number; usuarioId: number; valorTotal: number; n: number; primeira: string; motivo: string | null; dia: string }): Promise<ResultadoAcordo>
  /** O histórico de acordos da operação (do mais novo ao mais antigo); null se ela não existe no escopo. */
  listar(alvo: AlvoAcordo, operacaoId: number, escopo: EscopoAcordos): Promise<AcordoRegistro[] | null>
}

const T = { VENDA: { op: 'vendas', opFk: 'venda_id' }, EMPRESTIMO: { op: 'emprestimos', opFk: 'emprestimo_id' } } as const
const dia = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)

export function createAcordosRepository(db: Knex): AcordosRepository {
  return {
    async fazer(d) {
      return db.transaction(async (trx) => {
        const t = T[d.alvo]
        if (!(await trx(t.op).where({ id: d.operacaoId }).forUpdate().first('id'))) {
          throw naoEncontrado(d.alvo === 'VENDA' ? 'Venda não encontrada' : 'Empréstimo não encontrado')
        }
        return fazerAcordo(trx, d)
      })
    },

    async listar(alvo, operacaoId, escopo) {
      const t = T[alvo]
      const q = db(`${t.op} as o`).join('clientes as c', 'c.id', 'o.cliente_id').where('o.id', operacaoId)
      if (escopo.tipo === 'CARTEIRA') q.where('c.responsavel_id', escopo.usuarioId)
      if (!(await q.first('o.id'))) return null
      const ls = await db('acordos as a').leftJoin('users as u', 'u.id', 'a.criado_por').where(`a.${t.opFk}`, operacaoId).orderBy('a.id', 'desc')
        .select<{ id: number; data_acordo: Date | string; saldo_antes: string; valor_total: string; n_parcelas: number; primeira_parcela: Date | string; motivo: string | null; status: 'ATIVO' | 'SUBSTITUIDO'; nome: string | null; aprovacao_id: number | null }[]>(
          'a.id', 'a.data_acordo', 'a.saldo_antes', 'a.valor_total', 'a.n_parcelas', 'a.primeira_parcela', 'a.motivo', 'a.status', 'u.nome', 'a.aprovacao_id',
        )
      return ls.map((l) => ({ id: l.id, dataAcordo: dia(l.data_acordo), saldoAntes: Number(l.saldo_antes), valorTotal: Number(l.valor_total), nParcelas: l.n_parcelas, primeiraParcela: dia(l.primeira_parcela), motivo: l.motivo, status: l.status, feitoPor: l.nome, aprovacaoId: l.aprovacao_id }))
    },
  }
}
