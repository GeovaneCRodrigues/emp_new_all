import { randomBytes } from 'node:crypto'
import { HttpError, naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import { normalizarFone } from '../../../shared/documentos.js'
import type { Sessao } from '../../../shared/perfis.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import { hashSenha } from '../../auth/services/password.js'
import type { IndicadoresRepository } from '../models/repository.js'
import type { DadosIndicador, Indicador, Nivel } from '../models/types.js'
import { nivelDe, validarNiveis } from './niveis.js'

export type Entrada = Record<string, unknown>
export type IndicadorComNivel = Indicador & { nivel: Nivel; proximoNivel: Nivel | null; faltamParaProximo: number | null }
export type TabelaNiveis = { niveis: Nivel[]; auto: boolean }

export type IndicadoresService = {
  listar(s: Sessao): Promise<IndicadorComNivel[]>
  /** Quem pode ser escolhido numa venda: só id e nome, sem o % (o vendedor não vê a parte do indicador). */
  opcoes(s: Sessao): Promise<{ id: number; nome: string }[]>
  obter(s: Sessao, id: number): Promise<IndicadorComNivel>
  criar(s: Sessao, e: Entrada): Promise<IndicadorComNivel>
  atualizar(s: Sessao, id: number, e: Entrada): Promise<IndicadorComNivel>
  criarAcesso(s: Sessao, id: number, e: Entrada): Promise<{ email: string; senhaTemporaria: string }>
  niveis(s: Sessao): Promise<TabelaNiveis>
  salvarNiveis(s: Sessao, e: Entrada): Promise<TabelaNiveis>
  /** Põe o % dos indicadores "automáticos" de acordo com o nível. As operações novas (vendas, empréstimos) chamam isto. */
  sincronizarNiveis(): Promise<void>
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function exigirAdmin(s: Sessao) {
  if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador gerencia indicadores')
}

/** Texto opcional: aparado, vazio vira null. `undefined` = o campo não veio. */
function opcional(e: Entrada, campo: string, max: number): string | null | undefined {
  if (!(campo in e)) return undefined
  const v = e[campo]
  if (v === null || v === '') return null
  if (typeof v !== 'string') throw requisicaoInvalida(`${campo} deve ser texto`)
  const t = v.trim()
  if (t.length > max) throw requisicaoInvalida(`${campo} pode ter no máximo ${max} caracteres`)
  return t || null
}

function lerPct(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1) throw requisicaoInvalida('O % do lucro precisa ficar entre 0 e 100')
  return Math.round(v * 10000) / 10000
}

const ACESSO_EXISTENTE = new HttpError(409, 'Este indicador já tem acesso', 'ACESSO_EXISTENTE')
const EMAIL_EM_USO = new HttpError(409, 'Já existe um usuário com esse e-mail', 'EMAIL_EM_USO')

export function createIndicadoresService(repo: IndicadoresRepository, auditoria: AuditoriaRepository): IndicadoresService {
  const comNivel = (i: Indicador, niveis: Nivel[]): IndicadorComNivel => {
    const { atual, proximo } = nivelDe(i.operacoes, niveis)
    return { ...i, nivel: atual, proximoNivel: proximo, faltamParaProximo: proximo ? proximo.minOperacoes - i.operacoes : null }
  }

  /** O % que o nível dá a quem tem `operacoes` operações. */
  const pctDoNivel = (operacoes: number, niveis: Nivel[]) => nivelDe(operacoes, niveis).atual.pct

  async function sincronizar(): Promise<void> {
    if (!(await repo.niveisAuto())) return
    const niveis = await repo.niveis()
    for (const i of await repo.listar()) {
      const pct = pctDoNivel(i.operacoes, niveis)
      if (!i.pctManual && i.pct !== pct) await repo.atualizar(i.id, { pct })
    }
  }

  async function visao(id: number): Promise<IndicadorComNivel> {
    const i = await repo.buscar(id)
    if (!i) throw naoEncontrado('Indicador não encontrado')
    return comNivel(i, await repo.niveis())
  }

  function lerDados(e: Entrada, parcial: boolean): Partial<DadosIndicador> {
    const d: Partial<DadosIndicador> = {}
    if (!parcial || 'nome' in e) {
      if (typeof e.nome !== 'string' || e.nome.trim().length < 2) throw requisicaoInvalida('Informe o nome do indicador (ao menos 2 letras)')
      if (e.nome.trim().length > 160) throw requisicaoInvalida('nome pode ter no máximo 160 caracteres')
      d.nome = e.nome.trim().replace(/\s+/g, ' ')
    }
    const zap = opcional(e, 'whatsapp', 30)
    if (zap !== undefined) {
      if (zap === null) d.whatsapp = null
      else {
        const f = normalizarFone(zap)
        if (!f) throw requisicaoInvalida('WhatsApp inválido. Use DDD + número, por exemplo (11) 98812-4410')
        d.whatsapp = f
      }
    } else if (!parcial) d.whatsapp = null
    const pix = opcional(e, 'chavePix', 120)
    if (pix !== undefined) d.chavePix = pix
    else if (!parcial) d.chavePix = null
    return d
  }

  return {
    async listar(s) {
      exigirAdmin(s)
      const niveis = await repo.niveis()
      return (await repo.listar()).map((i) => comNivel(i, niveis))
    },

    async opcoes(s) {
      if (s.perfil !== 'ADMIN' && s.perfil !== 'VENDEDOR') throw semPermissao('Você não tem acesso à lista de indicadores')
      return (await repo.listar()).filter((i) => i.ativo).map((i) => ({ id: i.id, nome: i.nome }))
    },

    async obter(s, id) {
      exigirAdmin(s)
      return visao(id)
    },

    async criar(s, e) {
      exigirAdmin(s)
      const d = lerDados(e, false) as DadosIndicador
      if (e.automatico === true) {
        if ('pct' in e) throw requisicaoInvalida('Informe o % ou "automático", não os dois')
        d.pct = pctDoNivel(0, await repo.niveis())
        d.pctManual = false
      } else {
        d.pct = lerPct(e.pct)
        d.pctManual = true
      }
      const criado = await repo.criar(d)
      await auditoria.registrar({ usuarioId: s.usuarioId, acao: 'INDICADOR_CRIADO', entidade: 'indicador', entidadeId: criado.id, depois: criado })
      return visao(criado.id)
    },

    async atualizar(s, id, e) {
      exigirAdmin(s)
      const antes = await repo.buscar(id)
      if (!antes) throw naoEncontrado('Indicador não encontrado')
      const d = lerDados(e, true)

      if ('pct' in e && e.automatico === true) throw requisicaoInvalida('Informe o % ou "automático", não os dois')
      if ('pct' in e) { d.pct = lerPct(e.pct); d.pctManual = true }
      else if (e.automatico === true) { d.pct = pctDoNivel(antes.operacoes, await repo.niveis()); d.pctManual = false }

      let atual = Object.keys(d).length ? await repo.atualizar(id, d) : antes
      if ('ativo' in e) {
        if (typeof e.ativo !== 'boolean') throw requisicaoInvalida('ativo deve ser verdadeiro ou falso')
        if (e.ativo !== atual.ativo) atual = await repo.definirAtivo(id, e.ativo)
      }
      await auditoria.registrar({ usuarioId: s.usuarioId, acao: 'INDICADOR_ALTERADO', entidade: 'indicador', entidadeId: id, antes, depois: atual })
      return visao(id)
    },

    async criarAcesso(s, id, e) {
      exigirAdmin(s)
      const i = await repo.buscar(id)
      if (!i) throw naoEncontrado('Indicador não encontrado')
      if (!i.ativo) throw requisicaoInvalida('Reative o indicador antes de criar o acesso')
      if (i.temAcesso) throw ACESSO_EXISTENTE
      const email = typeof e.email === 'string' ? e.email.trim().toLowerCase() : ''
      if (!EMAIL.test(email) || email.length > 255) throw requisicaoInvalida('E-mail inválido')

      // senha aleatória, mostrada só nesta resposta; o indicador é obrigado a trocar no primeiro acesso
      const senhaTemporaria = randomBytes(10).toString('base64url')
      try {
        await repo.criarAcesso(id, { nome: i.nome, email, senhaHash: await hashSenha(senhaTemporaria) })
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw (await repo.buscar(id))?.temAcesso ? ACESSO_EXISTENTE : EMAIL_EM_USO
        }
        throw err
      }
      await auditoria.registrar({ usuarioId: s.usuarioId, acao: 'INDICADOR_ACESSO_CRIADO', entidade: 'indicador', entidadeId: id, depois: { email } })
      return { email, senhaTemporaria }
    },

    async niveis(s) {
      exigirAdmin(s)
      return { niveis: await repo.niveis(), auto: await repo.niveisAuto() }
    },

    async salvarNiveis(s, e) {
      exigirAdmin(s)
      const atuais = await repo.niveis()
      const lista = Array.isArray(e.niveis) ? e.niveis : null
      if (!lista || lista.length !== atuais.length) throw requisicaoInvalida('Envie todos os níveis')
      if (typeof e.auto !== 'boolean') throw requisicaoInvalida('Informe se o % sobe sozinho (auto)')

      const novos: Nivel[] = atuais.map((a) => {
        const n = lista.find((x) => x && typeof x === 'object' && (x as Nivel).id === a.id) as Partial<Nivel> | undefined
        if (!n) throw requisicaoInvalida(`Falta o nível ${a.nome}`)
        return { ...a, minOperacoes: n.minOperacoes as number, pct: n.pct as number }
      })
      const erro = validarNiveis(novos.slice().sort((a, b) => a.minOperacoes - b.minOperacoes))
      if (erro) throw requisicaoInvalida(erro)

      const antes = { niveis: atuais, auto: await repo.niveisAuto() }
      await repo.salvarNiveis(novos, e.auto)
      await sincronizar()
      await auditoria.registrar({ usuarioId: s.usuarioId, acao: 'NIVEIS_ALTERADOS', entidade: 'niveis', entidadeId: 0, antes, depois: { niveis: novos, auto: e.auto } })
      return { niveis: await repo.niveis(), auto: e.auto }
    },

    sincronizarNiveis: sincronizar,
  }
}
