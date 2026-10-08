import { HttpError, naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import { imeiValido, soDigitos } from '../../../shared/documentos.js'
import type { Sessao } from '../../../shared/perfis.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import type { EstoqueRepository } from '../models/repository.js'
import { ESTADOS, type Aparelho, type DadosAparelho, type EstadoAparelho, type ResumoEstoque } from '../models/types.js'

export type Entrada = Record<string, unknown>
export type ResultadoLista = { itens: Aparelho[]; total: number; pagina: number; limite: number }

export type EstoqueService = {
  listar(s: Sessao, q: { busca?: string; estado?: string; pagina?: number; limite?: number }): Promise<ResultadoLista>
  obter(s: Sessao, id: number): Promise<Aparelho>
  criar(s: Sessao, e: Entrada): Promise<Aparelho>
  atualizar(s: Sessao, id: number, e: Entrada): Promise<Aparelho>
  resumo(s: Sessao): Promise<ResumoEstoque>
}

const LIMITE_MAX = 100
const DINHEIRO_MAX = 100_000_000
const IMEI_DUPLICADO = new HttpError(409, 'Já existe um aparelho com esse IMEI', 'IMEI_DUPLICADO')

/** Quem enxerga o estoque: o admin vê tudo; o vendedor só o que está à venda (disponível e encomendado), sem custo. */
function exigirVer(s: Sessao) {
  if (s.perfil !== 'ADMIN' && s.perfil !== 'VENDEDOR') throw semPermissao('Você não tem acesso ao estoque')
}
function exigirAdmin(s: Sessao) {
  if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador cadastra e edita aparelhos')
}
const estadosVisiveis = (s: Sessao): EstadoAparelho[] | undefined => (s.perfil === 'ADMIN' ? undefined : ['DISPONIVEL', 'ENCOMENDADO'])

function texto(e: Entrada, campo: string, min: number, max: number): string {
  const v = e[campo]
  if (typeof v !== 'string' || v.trim().length < min) throw requisicaoInvalida(`Informe ${campo} (ao menos ${min} letras)`)
  if (v.trim().length > max) throw requisicaoInvalida(`${campo} pode ter no máximo ${max} caracteres`)
  return v.trim().replace(/\s+/g, ' ')
}
function inteiro(e: Entrada, campo: string, min: number, max: number): number {
  const v = e[campo]
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw requisicaoInvalida(`${campo} precisa ser um número inteiro entre ${min} e ${max}`)
  return v
}
function dinheiro(e: Entrada, campo: string, minimoExclusivo: boolean): number {
  const v = e[campo]
  if (typeof v !== 'number' || !Number.isFinite(v) || v > DINHEIRO_MAX || (minimoExclusivo ? v <= 0 : v < 0)) {
    throw requisicaoInvalida(minimoExclusivo ? `${campo} precisa ser maior que zero` : `${campo} não pode ser negativo`)
  }
  return Math.round(v * 100) / 100
}
function data(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) !== v) throw requisicaoInvalida('dataCompra precisa ser uma data válida (AAAA-MM-DD)')
  return v
}

export function createEstoqueService(repo: EstoqueRepository, auditoria: AuditoriaRepository): EstoqueService {
  /** Redige o que o perfil não pode ver. Defesa em profundidade: a view também não envia esses campos. */
  async function paraPerfil(s: Sessao, itens: Aparelho[]): Promise<Aparelho[]> {
    if (s.perfil === 'ADMIN') return itens
    const visiveis = await repo.clientesDaCarteira(itens.flatMap((a) => (a.paraCliente ? [a.paraCliente.id] : [])), s.usuarioId)
    return itens.map((a) => ({
      ...a, custo: 0, extras: 0, observacoes: null,
      // o nome de quem encomendou só aparece para o vendedor dono daquele cliente
      paraCliente: a.paraCliente && visiveis.has(a.paraCliente.id) ? a.paraCliente : null,
    }))
  }

  /** Lê os campos do corpo. Em `parcial`, só os que vieram. */
  async function lerDados(e: Entrada, parcial: boolean): Promise<Partial<DadosAparelho>> {
    const d: Partial<DadosAparelho> = {}
    const tem = (c: string) => !parcial || c in e
    if (tem('modelo')) d.modelo = texto(e, 'modelo', 2, 80)
    if (tem('gb')) d.gb = inteiro(e, 'gb', 8, 4096)
    if (tem('cor')) d.cor = texto(e, 'cor', 2, 40)
    if ('bateria' in e || !parcial) d.bateria = 'bateria' in e ? inteiro(e, 'bateria', 0, 100) : 100
    if ('condicao' in e || !parcial) {
      const c = 'condicao' in e ? e.condicao : 'Seminovo'
      if (c !== 'Novo' && c !== 'Seminovo') throw requisicaoInvalida('condicao deve ser Novo ou Seminovo')
      d.condicao = c
    }
    if ('origem' in e || !parcial) {
      const o = 'origem' in e ? e.origem : 'COMPRA'
      if (o !== 'COMPRA' && o !== 'TROCA') throw requisicaoInvalida('origem deve ser COMPRA ou TROCA')
      d.origem = o
    }
    if ('custo' in e || !parcial) d.custo = 'custo' in e ? dinheiro(e, 'custo', false) : 0
    if ('extras' in e || !parcial) d.extras = 'extras' in e ? dinheiro(e, 'extras', false) : 0
    if (tem('preco')) d.preco = dinheiro(e, 'preco', true)
    if ('dataCompra' in e) d.dataCompra = data(e.dataCompra)
    else if (!parcial) d.dataCompra = new Date().toISOString().slice(0, 10)
    if ('imei' in e) {
      if (e.imei === null || e.imei === '') d.imei = null
      else if (typeof e.imei !== 'string' || !imeiValido(e.imei)) throw requisicaoInvalida('IMEI inválido. Confira os 15 dígitos')
      else d.imei = soDigitos(e.imei)
    } else if (!parcial) d.imei = null
    if ('observacoes' in e) {
      if (e.observacoes === null || e.observacoes === '') d.observacoes = null
      else if (typeof e.observacoes !== 'string' || e.observacoes.length > 500) throw requisicaoInvalida('observacoes pode ter no máximo 500 caracteres')
      else d.observacoes = e.observacoes.trim() || null
    } else if (!parcial) d.observacoes = null
    return d
  }

  /** Estado e encomenda andam juntos: ENCOMENDADO pede o cliente; DISPONIVEL não tem cliente. */
  async function aplicarEstado(e: Entrada, d: Partial<DadosAparelho>, atual: Aparelho | null) {
    const estado = ('estado' in e ? e.estado : (atual?.estado ?? 'DISPONIVEL')) as unknown
    if (!ESTADOS.includes(estado as EstadoAparelho)) throw requisicaoInvalida('estado inválido')
    if (estado === 'VENDIDO') throw requisicaoInvalida('O estado "vendido" muda só pela venda, não pela edição do aparelho')
    d.estado = estado as EstadoAparelho

    const clienteId = 'paraClienteId' in e ? e.paraClienteId : (atual?.paraCliente?.id ?? null)
    if (estado === 'ENCOMENDADO') {
      if (typeof clienteId !== 'number' || !Number.isInteger(clienteId) || !(await repo.clienteExiste(clienteId))) throw requisicaoInvalida('Escolha o cliente que encomendou')
      d.paraClienteId = clienteId
    } else {
      if ('paraClienteId' in e && e.paraClienteId !== null) throw requisicaoInvalida('Só aparelho encomendado tem cliente')
      d.paraClienteId = null
    }
  }

  const trataDuplicado = (err: unknown): never => {
    if ((err as { code?: string })?.code === '23505') throw IMEI_DUPLICADO
    throw err
  }

  return {
    async listar(s, q) {
      exigirVer(s)
      const limite = Math.min(Math.max(Math.trunc(q.limite ?? 20) || 20, 1), LIMITE_MAX)
      const pagina = Math.max(Math.trunc(q.pagina ?? 1) || 1, 1)
      if (q.estado && !ESTADOS.includes(q.estado as EstadoAparelho)) throw requisicaoInvalida('estado inválido')
      const r = await repo.listar({ busca: q.busca, estado: q.estado as EstadoAparelho | undefined, estados: estadosVisiveis(s), limite, offset: (pagina - 1) * limite })
      return { itens: await paraPerfil(s, r.itens), total: r.total, pagina, limite }
    },

    async obter(s, id) {
      exigirVer(s)
      const a = await repo.buscar(id)
      if (!a || (estadosVisiveis(s) && !estadosVisiveis(s)!.includes(a.estado))) throw naoEncontrado('Aparelho não encontrado')
      return (await paraPerfil(s, [a]))[0]
    },

    async criar(s, e) {
      exigirAdmin(s)
      const d = (await lerDados(e, false)) as DadosAparelho
      await aplicarEstado(e, d, null)
      if (d.imei && (await repo.buscarPorImei(d.imei))) throw IMEI_DUPLICADO
      const criado = await repo.criar(d).catch(trataDuplicado)
      await auditoria.registrar({ usuarioId: s.usuarioId, acao: 'APARELHO_CRIADO', entidade: 'aparelho', entidadeId: criado.id, depois: criado })
      return criado
    },

    async atualizar(s, id, e) {
      exigirAdmin(s)
      const antes = await repo.buscar(id)
      if (!antes) throw naoEncontrado('Aparelho não encontrado')
      if (antes.estado === 'VENDIDO') throw new HttpError(409, 'Aparelho vendido não pode ser alterado', 'APARELHO_VENDIDO')

      // reenviar o IMEI que já está cadastrado não é uma mudança: dados antigos (importados) podem não passar na
      // validação de dígito verificador, e isso não pode impedir de corrigir o preço. Só valida quando muda.
      const corpo: Entrada = { ...e }
      if (typeof e.imei === 'string' && soDigitos(e.imei) === antes.imei) delete corpo.imei

      const d = await lerDados(corpo, true)
      if ('estado' in e || 'paraClienteId' in e) await aplicarEstado(e, d, antes)
      if (d.imei && d.imei !== antes.imei) {
        const outro = await repo.buscarPorImei(d.imei)
        if (outro && outro.id !== id) throw IMEI_DUPLICADO
      }
      const depois = await repo.atualizar(id, d).catch(trataDuplicado)
      await auditoria.registrar({ usuarioId: s.usuarioId, acao: 'APARELHO_ALTERADO', entidade: 'aparelho', entidadeId: id, antes, depois })
      return depois
    },

    async resumo(s) {
      exigirVer(s)
      const r = await repo.resumo()
      return s.perfil === 'ADMIN' ? r : { ...r, capitalParado: 0, margemMedia: 0 }
    },
  }
}
