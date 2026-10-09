import type { Knex } from 'knex'
import type { EscopoPropostas, FiltroPropostas, NovaProposta, Proposta, StatusProposta, TipoProposta } from './types.js'

/** O que dá para fazer com a proposta travada (duas respostas ao mesmo tempo esperam uma pela outra). */
export interface PropostaTx {
  /** Trava e devolve o estado atual; null se não existe no escopo. */
  buscarTravada(id: number): Promise<Proposta | null>
  /** A venda ou empréstimo existe? De quem é? (para conferir que é do mesmo cliente e do mesmo indicador) */
  operacao(tipo: TipoProposta, id: number): Promise<{ clienteId: number; indicadorId: number | null } | null>
  responder(id: number, d: { status: StatusProposta; usuarioId: number | null; motivo?: string | null; operacao?: { tipo: TipoProposta; id: number } | null }): Promise<Proposta>
}

export interface PropostasRepository {
  /** O cliente existe e é dele (cadastrou ou tem venda/empréstimo com ele)? */
  clienteDoIndicador(clienteId: number, indicadorId: number): Promise<{ id: number } | null>
  aparelhoExiste(id: number): Promise<{ id: number; modelo: string; gb: number; cor: string } | null>
  criar(d: NovaProposta): Promise<Proposta>
  listar(escopo: EscopoPropostas, filtro: FiltroPropostas): Promise<{ itens: Proposta[]; total: number; pendentes: number }>
  buscar(id: number, escopo: EscopoPropostas): Promise<Proposta | null>
  emTransacao<T>(escopo: EscopoPropostas, fn: (tx: PropostaTx) => Promise<T>): Promise<T>
}

type Linha = {
  id: number; indicador_id: number; indicador_nome: string; cliente_id: number; cliente_nome: string; cliente_fone: string
  tipo: TipoProposta; interesse: string | null; aparelho_id: number | null; modelo: string | null; gb: number | null; cor: string | null
  valor: string | null; parcelas: number | null; obs: string | null; status: StatusProposta; motivo_recusa: string | null
  nome_resp: string | null; respondido_em: Date | null; venda_id: number | null; emprestimo_id: number | null; created_at: Date
}

const paraProposta = (l: Linha): Proposta => ({
  id: l.id, indicador: { id: l.indicador_id, nome: l.indicador_nome }, cliente: { id: l.cliente_id, nome: l.cliente_nome, fone: l.cliente_fone },
  tipo: l.tipo, interesse: l.interesse,
  aparelho: l.aparelho_id && l.modelo ? { id: l.aparelho_id, modelo: l.modelo, gb: l.gb!, cor: l.cor! } : null,
  valor: l.valor === null ? null : Number(l.valor), parcelas: l.parcelas, obs: l.obs, status: l.status, motivoRecusa: l.motivo_recusa,
  respondidoPor: l.nome_resp, respondidoEm: l.respondido_em ? new Date(l.respondido_em).toISOString() : null,
  operacao: l.venda_id ? { tipo: 'VENDA', id: l.venda_id } : l.emprestimo_id ? { tipo: 'EMPRESTIMO', id: l.emprestimo_id } : null,
  criadaEm: new Date(l.created_at).toISOString(),
})

export function createPropostasRepository(db: Knex): PropostasRepository {
  const base = (k: Knex | Knex.Transaction, escopo: EscopoPropostas) => {
    const q = k('indicacoes as p')
      .join('indicadores as i', 'i.id', 'p.indicador_id').join('clientes as c', 'c.id', 'p.cliente_id')
      .leftJoin('bens as b', 'b.id', 'p.aparelho_id').leftJoin('users as u', 'u.id', 'p.respondido_por')
    if (escopo.tipo === 'INDICADOR') q.where('p.indicador_id', escopo.indicadorId)
    return q
  }
  const colunas = ['p.id', 'p.indicador_id', 'i.nome as indicador_nome', 'p.cliente_id', 'c.nome as cliente_nome', 'c.fone as cliente_fone', 'p.tipo', 'p.interesse', 'p.aparelho_id',
    'b.modelo', 'b.gb', 'b.cor', 'p.valor', 'p.parcelas', 'p.obs', 'p.status', 'p.motivo_recusa', 'u.nome as nome_resp', 'p.respondido_em', 'p.venda_id', 'p.emprestimo_id', 'p.created_at']
  const ler = async (k: Knex | Knex.Transaction, id: number, escopo: EscopoPropostas) => {
    const l = await base(k, escopo).where('p.id', id).select<Linha[]>(colunas).first()
    return l ? paraProposta(l) : null
  }

  return {
    async clienteDoIndicador(clienteId, indicadorId) {
      const l = await db('clientes as c').where('c.id', clienteId).where((w) => {
        w.where('c.indicador_id', indicadorId)
          .orWhereExists(function () { this.select(1).from('vendas').whereRaw('vendas.cliente_id = c.id').where('vendas.indicador_id', indicadorId) })
          .orWhereExists(function () { this.select(1).from('emprestimos').whereRaw('emprestimos.cliente_id = c.id').where('emprestimos.indicador_id', indicadorId) })
      }).first<{ id: number } | undefined>('c.id')
      return l ?? null
    },
    async aparelhoExiste(id) {
      return (await db('bens').where({ id }).first<{ id: number; modelo: string; gb: number; cor: string } | undefined>('id', 'modelo', 'gb', 'cor')) ?? null
    },
    async criar(d) {
      const [{ id }] = await db('indicacoes').insert({
        indicador_id: d.indicadorId, cliente_id: d.clienteId, tipo: d.tipo, interesse: d.interesse, aparelho_id: d.aparelhoId, valor: d.valor, parcelas: d.parcelas, obs: d.obs,
      }).returning('id')
      return (await ler(db, id, { tipo: 'TODOS' }))!
    },
    async listar(escopo, filtro) {
      const filtrada = () => {
        const q = base(db, escopo)
        if (filtro.status) q.where('p.status', filtro.status)
        if (filtro.indicadorId) q.where('p.indicador_id', filtro.indicadorId)
        return q
      }
      const [{ total }] = await filtrada().count<{ total: string }[]>({ total: '*' })
      const [{ pendentes }] = await base(db, escopo).where('p.status', 'PENDENTE').count<{ pendentes: string }[]>({ pendentes: '*' })
      // as pendentes primeiro (é o que a loja precisa responder), depois as mais novas
      const ls = await filtrada().select<Linha[]>(colunas).orderByRaw("(p.status = 'PENDENTE') desc, p.created_at desc, p.id desc").limit(filtro.limite).offset(filtro.offset)
      return { itens: ls.map(paraProposta), total: Number(total), pendentes: Number(pendentes) }
    },
    async buscar(id, escopo) { return ler(db, id, escopo) },
    async emTransacao(escopo, fn) {
      return db.transaction(async (trx) => fn({
        async buscarTravada(id) {
          const trava = trx('indicacoes as p').where('p.id', id)
          if (escopo.tipo === 'INDICADOR') trava.where('p.indicador_id', escopo.indicadorId)
          if (!(await trava.forUpdate().first('p.id'))) return null
          return ler(trx, id, escopo)
        },
        async operacao(tipo, id) {
          const l = await trx(tipo === 'VENDA' ? 'vendas' : 'emprestimos').where({ id }).first<{ cliente_id: number; indicador_id: number | null } | undefined>('cliente_id', 'indicador_id')
          return l ? { clienteId: l.cliente_id, indicadorId: l.indicador_id } : null
        },
        async responder(id, d) {
          await trx('indicacoes').where({ id }).update({
            status: d.status, respondido_por: d.usuarioId, respondido_em: trx.fn.now(), motivo_recusa: d.motivo ?? null,
            venda_id: d.operacao?.tipo === 'VENDA' ? d.operacao.id : null, emprestimo_id: d.operacao?.tipo === 'EMPRESTIMO' ? d.operacao.id : null, updated_at: trx.fn.now(),
          })
          return (await ler(trx, id, { tipo: 'TODOS' }))!
        },
      }))
    },
  }
}
