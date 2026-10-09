import type { Knex } from 'knex'
import { soDigitos } from '../../../shared/documentos.js'
import type { Cliente, DadosCliente, EscopoClientes, FiltroClientes } from './types.js'

export interface ClientesRepository {
  listar(escopo: EscopoClientes, filtro: FiltroClientes): Promise<{ itens: Cliente[]; total: number }>
  /** Só devolve se o cliente está dentro do escopo; fora dele é como se não existisse. */
  buscar(id: number, escopo: EscopoClientes): Promise<Cliente | null>
  criar(dados: DadosCliente): Promise<Cliente>
  atualizar(id: number, dados: Partial<DadosCliente>): Promise<Cliente>
  buscarPorCpf(cpf: string): Promise<Cliente | null>
  /** Outro cliente (que não `exceto`) com o mesmo telefone, para o aviso de duplicidade. */
  buscarPorFone(fone: string, exceto?: number): Promise<Cliente | null>
  /** O usuário existe, está ativo e pode ter carteira (não é indicador)? */
  usuarioPodeSerResponsavel(usuarioId: number): Promise<boolean>
}

type Linha = {
  id: number; nome: string; fone: string; cpf: string | null; rg: string | null; endereco: string | null
  origem: string | null; responsavel_id: number | null; indicador_id: number | null; created_at: Date
}

const paraCliente = (l: Linha): Cliente => ({
  id: l.id, nome: l.nome, fone: l.fone, cpf: l.cpf, rg: l.rg, endereco: l.endereco, origem: l.origem,
  responsavelId: l.responsavel_id, indicadorId: l.indicador_id, desde: new Date(l.created_at).toISOString().slice(0, 10),
})

const paraLinha = (d: Partial<DadosCliente>) => {
  const l: Record<string, unknown> = {}
  if (d.nome !== undefined) l.nome = d.nome
  if (d.fone !== undefined) l.fone = d.fone
  if (d.cpf !== undefined) l.cpf = d.cpf
  if (d.rg !== undefined) l.rg = d.rg
  if (d.endereco !== undefined) l.endereco = d.endereco
  if (d.origem !== undefined) l.origem = d.origem
  if (d.responsavelId !== undefined) l.responsavel_id = d.responsavelId
  if (d.indicadorId !== undefined) l.indicador_id = d.indicadorId
  return l
}

/** Escapa `%`, `_` e `\` para a busca tratar o que o usuário digitou como texto, não como curinga. */
const escaparLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c)

function aplicarEscopo(q: Knex.QueryBuilder, e: EscopoClientes) {
  if (e.tipo === 'CARTEIRA') q.where('clientes.responsavel_id', e.usuarioId)
  else if (e.tipo === 'INDICADOR') {
    q.where((w) => {
      // os que ele mesmo cadastrou, mais os que têm venda ou empréstimo com ele como indicador
      w.where('clientes.indicador_id', e.indicadorId)
        .orWhereExists(function () { this.select(1).from('vendas').whereRaw('vendas.cliente_id = clientes.id').where('vendas.indicador_id', e.indicadorId) })
        .orWhereExists(function () { this.select(1).from('emprestimos').whereRaw('emprestimos.cliente_id = clientes.id').where('emprestimos.indicador_id', e.indicadorId) })
    })
  }
  return q
}

export function createClientesRepository(db: Knex): ClientesRepository {
  return {
    async listar(escopo, filtro) {
      const base = () => {
        const q = aplicarEscopo(db('clientes'), escopo)
        const busca = filtro.busca?.trim()
        if (busca) {
          const txt = `%${escaparLike(busca.toLowerCase())}%`
          const dig = soDigitos(busca)
          q.where((w) => {
            w.whereRaw("lower(clientes.nome) like ? escape '\\'", [txt])
            if (dig) w.orWhereRaw("clientes.fone like ? escape '\\'", [`%${dig}%`]).orWhereRaw("clientes.cpf like ? escape '\\'", [`%${dig}%`])
          })
        }
        return q
      }
      const [{ total }] = await base().count<{ total: string }[]>({ total: '*' })
      const linhas = await base().select<Linha[]>('clientes.*').orderByRaw('lower(clientes.nome), clientes.id').limit(filtro.limite).offset(filtro.offset)
      return { itens: linhas.map(paraCliente), total: Number(total) }
    },
    async buscar(id, escopo) {
      const l = await aplicarEscopo(db('clientes'), escopo).where('clientes.id', id).select<Linha[]>('clientes.*').first()
      return l ? paraCliente(l) : null
    },
    async criar(d) {
      const [l] = await db('clientes').insert(paraLinha(d)).returning<Linha[]>('*')
      return paraCliente(l)
    },
    async atualizar(id, d) {
      const [l] = await db('clientes').where({ id }).update({ ...paraLinha(d), updated_at: db.fn.now() }).returning<Linha[]>('*')
      return paraCliente(l)
    },
    async buscarPorCpf(cpf) {
      const l = await db<Linha>('clientes').where({ cpf }).first()
      return l ? paraCliente(l) : null
    },
    async buscarPorFone(fone, exceto) {
      const q = db<Linha>('clientes').where({ fone })
      if (exceto) q.whereNot({ id: exceto })
      const l = await q.first()
      return l ? paraCliente(l) : null
    },
    async usuarioPodeSerResponsavel(usuarioId) {
      const u = await db('users').where({ id: usuarioId, ativo: true }).whereNot({ perfil: 'INDICADOR' }).first('id')
      return !!u
    },
  }
}
