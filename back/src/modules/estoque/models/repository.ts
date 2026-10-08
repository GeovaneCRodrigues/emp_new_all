import type { Knex } from 'knex'
import { soDigitos } from '../../../shared/documentos.js'
import type { Aparelho, DadosAparelho, EstadoAparelho, FiltroAparelhos, ResumoEstoque } from './types.js'

export interface EstoqueRepository {
  listar(f: FiltroAparelhos): Promise<{ itens: Aparelho[]; total: number }>
  buscar(id: number): Promise<Aparelho | null>
  criar(d: DadosAparelho): Promise<Aparelho>
  atualizar(id: number, d: Partial<DadosAparelho>): Promise<Aparelho>
  buscarPorImei(imei: string): Promise<Aparelho | null>
  clienteExiste(id: number): Promise<boolean>
  /** Dos clientes pedidos, quais estão na carteira desse usuário (para o vendedor só ver a encomenda dos dele). */
  clientesDaCarteira(ids: number[], usuarioId: number): Promise<Set<number>>
  resumo(): Promise<ResumoEstoque>
}

type Linha = {
  id: number; modelo: string; gb: number; cor: string; bateria: number; condicao: Aparelho['condicao']; imei: string | null
  valor_compra: string; custos_extras: string; preco_venda: string; estado: EstadoAparelho; origem: Aparelho['origem']
  data_compra: Date | string; cliente_encomenda_id: number | null; cliente_nome: string | null; observacoes: string | null
}

const dia = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)

const paraAparelho = (l: Linha): Aparelho => ({
  id: l.id, modelo: l.modelo, gb: l.gb, cor: l.cor, bateria: l.bateria, condicao: l.condicao, imei: l.imei,
  custo: Number(l.valor_compra), extras: Number(l.custos_extras), preco: Number(l.preco_venda), estado: l.estado, origem: l.origem,
  dataCompra: dia(l.data_compra), observacoes: l.observacoes,
  paraCliente: l.cliente_encomenda_id ? { id: l.cliente_encomenda_id, nome: l.cliente_nome ?? '' } : null,
})

const paraLinha = (d: Partial<DadosAparelho>) => {
  const l: Record<string, unknown> = {}
  if (d.modelo !== undefined) l.modelo = d.modelo
  if (d.gb !== undefined) l.gb = d.gb
  if (d.cor !== undefined) l.cor = d.cor
  if (d.bateria !== undefined) l.bateria = d.bateria
  if (d.condicao !== undefined) l.condicao = d.condicao
  if (d.imei !== undefined) l.imei = d.imei
  if (d.custo !== undefined) l.valor_compra = d.custo
  if (d.extras !== undefined) l.custos_extras = d.extras
  if (d.preco !== undefined) l.preco_venda = d.preco
  if (d.estado !== undefined) l.estado = d.estado
  if (d.origem !== undefined) l.origem = d.origem
  if (d.dataCompra !== undefined) l.data_compra = d.dataCompra
  if (d.paraClienteId !== undefined) l.cliente_encomenda_id = d.paraClienteId
  if (d.observacoes !== undefined) l.observacoes = d.observacoes
  return l
}

/** Escapa `%`, `_` e `\` para a busca tratar o que foi digitado como texto, não como curinga. */
const escaparLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c)

export function createEstoqueRepository(db: Knex): EstoqueRepository {
  const consulta = () => db('bens as b').leftJoin('clientes as c', 'c.id', 'b.cliente_encomenda_id').select<Linha[]>('b.*', 'c.nome as cliente_nome')

  const buscar = async (id: number) => {
    const l = await consulta().where('b.id', id).first()
    return l ? paraAparelho(l) : null
  }

  return {
    async listar(f) {
      const filtrar = (q: Knex.QueryBuilder) => {
        if (f.estados?.length) q.whereIn('b.estado', f.estados)
        if (f.estado) q.where('b.estado', f.estado)
        const busca = f.busca?.trim()
        if (busca) {
          const txt = `%${escaparLike(busca.toLowerCase())}%`
          const dig = soDigitos(busca)
          q.where((w) => {
            w.whereRaw("lower(b.modelo || ' ' || b.gb || ' gb ' || b.cor) like ? escape '\\'", [txt])
            if (dig.length >= 3) w.orWhereRaw("b.imei like ? escape '\\'", [`%${dig}%`])
          })
        }
        return q
      }
      const [{ total }] = await filtrar(db('bens as b')).count<{ total: string }[]>({ total: '*' })
      const linhas = await filtrar(consulta()).orderBy([{ column: 'b.data_compra', order: 'desc' }, { column: 'b.id', order: 'desc' }]).limit(f.limite).offset(f.offset)
      return { itens: linhas.map(paraAparelho), total: Number(total) }
    },
    buscar,
    async criar(d) {
      const [{ id }] = await db('bens').insert(paraLinha(d)).returning('id')
      return (await buscar(id))!
    },
    async atualizar(id, d) {
      await db('bens').where({ id }).update({ ...paraLinha(d), updated_at: db.fn.now() })
      return (await buscar(id))!
    },
    async buscarPorImei(imei) {
      const l = await consulta().where('b.imei', imei).first()
      return l ? paraAparelho(l) : null
    },
    async clienteExiste(id) {
      return !!(await db('clientes').where({ id }).first('id'))
    },
    async clientesDaCarteira(ids, usuarioId) {
      if (!ids.length) return new Set()
      const ls = await db('clientes').whereIn('id', ids).where({ responsavel_id: usuarioId }).select<{ id: number }[]>('id')
      return new Set(ls.map((l) => l.id))
    },
    async resumo() {
      const r = await db('bens')
        .select(
          db.raw("count(*) filter (where estado = 'DISPONIVEL') as disponiveis"),
          db.raw("count(*) filter (where estado = 'ENCOMENDADO') as encomendados"),
          db.raw("coalesce(sum(valor_compra + custos_extras) filter (where estado = 'DISPONIVEL'), 0) as capital"),
          db.raw("coalesce(sum(preco_venda) filter (where estado = 'DISPONIVEL'), 0) as vitrine"),
          db.raw("coalesce(avg((preco_venda - valor_compra - custos_extras) / nullif(preco_venda, 0)) filter (where estado = 'DISPONIVEL'), 0) as margem"),
        )
        .first<{ disponiveis: string; encomendados: string; capital: string; vitrine: string; margem: string }>()
      return {
        disponiveis: Number(r!.disponiveis), encomendados: Number(r!.encomendados),
        capitalParado: Number(r!.capital), valorEmVitrine: Number(r!.vitrine), margemMedia: Number(r!.margem),
      }
    },
  }
}
