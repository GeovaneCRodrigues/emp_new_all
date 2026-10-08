import { HttpError, naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import { cpfValido, normalizarFone, soDigitos } from '../../../shared/documentos.js'
import type { Sessao } from '../../../shared/perfis.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import type { ClientesRepository } from '../models/repository.js'
import type { Cliente, DadosCliente, EscopoClientes } from '../models/types.js'

/** O que chega no corpo do pedido (ainda não validado). */
export type EntradaCliente = Record<string, unknown>
export type ResultadoSalvar = { cliente: Cliente; avisos: string[] }
export type ResultadoLista = { itens: Cliente[]; total: number; pagina: number; limite: number }

export type ClientesService = {
  listar(s: Sessao, q: { busca?: string; pagina?: number; limite?: number }): Promise<ResultadoLista>
  obter(s: Sessao, id: number): Promise<Cliente>
  criar(s: Sessao, entrada: EntradaCliente): Promise<ResultadoSalvar>
  atualizar(s: Sessao, id: number, entrada: EntradaCliente): Promise<ResultadoSalvar>
}

const LIMITE_MAX = 100

export function escopoDe(s: Sessao): EscopoClientes {
  if (s.perfil === 'ADMIN') return { tipo: 'TODOS' }
  if (s.perfil === 'INDICADOR') return { tipo: 'INDICADOR', indicadorId: s.indicadorId ?? -1 }
  return { tipo: 'CARTEIRA', usuarioId: s.usuarioId }
}

/** Texto opcional: aparado, vazio vira null, com limite de tamanho. `undefined` = campo não veio. */
function opcional(e: EntradaCliente, campo: string, max: number): string | null | undefined {
  if (!(campo in e)) return undefined
  const v = e[campo]
  if (v === null || v === '') return null
  if (typeof v !== 'string') throw requisicaoInvalida(`${campo} deve ser texto`)
  const t = v.trim()
  if (t.length > max) throw requisicaoInvalida(`${campo} pode ter no máximo ${max} caracteres`)
  return t || null
}

const CPF_DUPLICADO = new HttpError(409, 'Já existe um cliente com esse CPF', 'CPF_DUPLICADO')

export function createClientesService(repo: ClientesRepository, auditoria: AuditoriaRepository): ClientesService {
  /** Valida o corpo. Em `parcial` (edição) só valida os campos que vieram. */
  function validar(e: EntradaCliente, parcial: boolean): Partial<DadosCliente> {
    const d: Partial<DadosCliente> = {}

    if (!parcial || 'nome' in e) {
      if (typeof e.nome !== 'string' || e.nome.trim().length < 2) throw requisicaoInvalida('Informe o nome do cliente (ao menos 2 letras)')
      if (e.nome.trim().length > 160) throw requisicaoInvalida('nome pode ter no máximo 160 caracteres')
      d.nome = e.nome.trim().replace(/\s+/g, ' ')
    }
    if (!parcial || 'fone' in e) {
      const fone = typeof e.fone === 'string' ? normalizarFone(e.fone) : null
      if (!fone) throw requisicaoInvalida('Telefone inválido. Use DDD + número, por exemplo (11) 98812-4410')
      d.fone = fone
    }
    if ('cpf' in e) {
      const bruto = opcional(e, 'cpf', 20)
      if (bruto === null) d.cpf = null
      else if (bruto !== undefined) {
        if (!cpfValido(bruto)) throw requisicaoInvalida('CPF inválido')
        d.cpf = soDigitos(bruto)
      }
    } else if (!parcial) d.cpf = null

    for (const [campo, max] of [['rg', 20], ['endereco', 500], ['origem', 60]] as const) {
      const v = opcional(e, campo, max)
      if (v !== undefined) d[campo] = v
      else if (!parcial) d[campo] = null
    }
    return d
  }

  async function avisosDeFone(fone: string | undefined, exceto?: number): Promise<string[]> {
    if (!fone) return []
    const outro = await repo.buscarPorFone(fone, exceto)
    return outro ? [`Já existe um cliente com esse telefone: ${outro.nome}`] : []
  }

  async function checarResponsavel(id: unknown): Promise<number> {
    if (typeof id !== 'number' || !Number.isInteger(id) || !(await repo.usuarioPodeSerResponsavel(id))) throw requisicaoInvalida('Responsável inválido')
    return id
  }

  /** Banco recusou por CPF repetido (corrida entre dois cadastros): mesma resposta da checagem prévia. */
  const trataDuplicado = (err: unknown): never => {
    if ((err as { code?: string })?.code === '23505') throw CPF_DUPLICADO
    throw err
  }

  return {
    async listar(s, q) {
      const limite = Math.min(Math.max(Math.trunc(q.limite ?? 20) || 20, 1), LIMITE_MAX)
      const pagina = Math.max(Math.trunc(q.pagina ?? 1) || 1, 1)
      const r = await repo.listar(escopoDe(s), { busca: q.busca, limite, offset: (pagina - 1) * limite })
      return { ...r, pagina, limite }
    },

    async obter(s, id) {
      const c = await repo.buscar(id, escopoDe(s))
      if (!c) throw naoEncontrado('Cliente não encontrado')
      return c
    },

    async criar(s, entrada) {
      if (s.perfil !== 'ADMIN' && s.perfil !== 'VENDEDOR') throw semPermissao('Só o administrador e o vendedor cadastram clientes')
      const d = validar(entrada, false) as DadosCliente
      // vendedor cadastra sempre na própria carteira; o admin escolhe (ou fica sem responsável)
      if (s.perfil === 'VENDEDOR') d.responsavelId = s.usuarioId
      else d.responsavelId = entrada.responsavelId == null ? null : await checarResponsavel(entrada.responsavelId)

      if (d.cpf && (await repo.buscarPorCpf(d.cpf))) throw CPF_DUPLICADO
      const avisos = await avisosDeFone(d.fone)
      const cliente = await repo.criar(d).catch(trataDuplicado)
      await auditoria.registrar({ usuarioId: s.usuarioId, acao: 'CLIENTE_CRIADO', entidade: 'cliente', entidadeId: cliente.id, depois: cliente })
      return { cliente, avisos }
    },

    async atualizar(s, id, entrada) {
      if (s.perfil !== 'ADMIN' && s.perfil !== 'VENDEDOR') throw semPermissao('Só o administrador e o vendedor editam clientes')
      const antes = await repo.buscar(id, escopoDe(s))
      if (!antes) throw naoEncontrado('Cliente não encontrado')

      const d = validar(entrada, true)
      if ('responsavelId' in entrada) {
        if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador muda o responsável')
        d.responsavelId = entrada.responsavelId == null ? null : await checarResponsavel(entrada.responsavelId)
      }
      if (d.cpf && d.cpf !== antes.cpf) {
        const outro = await repo.buscarPorCpf(d.cpf)
        if (outro && outro.id !== id) throw CPF_DUPLICADO
      }
      const avisos = await avisosDeFone(d.fone !== antes.fone ? d.fone : undefined, id)
      const cliente = await repo.atualizar(id, d).catch(trataDuplicado)
      await auditoria.registrar({ usuarioId: s.usuarioId, acao: 'CLIENTE_ALTERADO', entidade: 'cliente', entidadeId: id, antes, depois: cliente })
      return { cliente, avisos }
    },
  }
}
