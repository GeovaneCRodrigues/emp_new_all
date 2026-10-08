import { criarSeed } from '@/data/seed'
import { normalizarFone } from '@/domain/documentos'
import type { Sessao } from '@/domain/escopo'
import { NIVEIS_PADRAO, nivelDe, validarNiveis } from '@/domain/repasse'
import { ErroApi } from './clientes'
import type { AcessoCriado, EntradaIndicador, IndicadorApi, IndicadoresApi, NivelApi, TabelaNiveis } from './indicadores'

interface Registro { id: number; nome: string; whatsapp: string | null; chavePix: string | null; pct: number; pctManual: boolean; ativo: boolean; email: string | null }

/**
 * Versão de demonstração: guarda tudo na memória e aplica as mesmas regras do backend
 * (só o admin gerencia, % manual x automático, níveis, um acesso por indicador).
 */
/** Ganchos só da demonstração: a venda de mentira faz o contador do indicador andar. */
export interface IndicadoresFake extends IndicadoresApi {
  _interno: { ativo(id: number): { id: number; nome: string; pct: number } | null; contarOperacao(id: number): void }
}

export function criarIndicadoresFake(): IndicadoresFake {
  const seed = criarSeed()
  let proximoId = 100
  let auto = true
  let niveis: NivelApi[] = NIVEIS_PADRAO.map((n) => ({ id: n.id, nome: n.nome, minOperacoes: n.min, pct: n.pct }))
  const registros: Registro[] = seed.indicadores.map((i) => ({
    id: i.id, nome: i.nome, whatsapp: i.id === 1 ? '11988887777' : null, chavePix: null, pct: i.pct, pctManual: true, ativo: true, email: null,
  }))

  const novas = new Map<number, number>()
  const operacoesDe = (id: number) => [...seed.vendas, ...seed.emprestimos].filter((o) => o.indicadorId === id && o.status !== ('CANCELADA' as never)).length + (novas.get(id) ?? 0)
  const comNiveis = () => niveis.map((n) => ({ id: n.id, nome: n.nome, min: n.minOperacoes, pct: n.pct }))
  const visao = (r: Registro): IndicadorApi => {
    const ops = operacoesDe(r.id)
    const { nivel, prox } = nivelDe(ops, comNiveis())
    const paraApi = (n: { id: string; nome: string; min: number; pct: number }): NivelApi => ({ id: n.id, nome: n.nome, minOperacoes: n.min, pct: n.pct })
    return {
      id: r.id, nome: r.nome, whatsapp: r.whatsapp, chavePix: r.chavePix, pct: r.pct, pctManual: r.pctManual, ativo: r.ativo,
      operacoes: ops, temAcesso: r.email !== null, nivel: paraApi(nivel), proximoNivel: prox ? paraApi(prox) : null,
      faltamParaProximo: prox ? prox.min - ops : null,
    }
  }
  const pctDoNivel = (ops: number) => nivelDe(ops, comNiveis()).nivel.pct
  const sincronizar = () => { if (auto) for (const r of registros) if (!r.pctManual) r.pct = pctDoNivel(operacoesDe(r.id)) }
  const admin = (s: Sessao) => { if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Só o administrador gerencia indicadores', 'SEM_PERMISSAO') }
  const achar = (id: number) => registros.find((r) => r.id === id) ?? (() => { throw new ErroApi(404, 'Indicador não encontrado', 'NAO_ENCONTRADO') })()
  const lerPct = (v: unknown) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1) throw new ErroApi(400, 'O % do lucro precisa ficar entre 0 e 100')
    return Math.round(v * 10000) / 10000
  }
  const lerCampos = (e: EntradaIndicador, parcial: boolean): Partial<Registro> => {
    const d: Partial<Registro> = {}
    if (!parcial || 'nome' in e) {
      if (typeof e.nome !== 'string' || e.nome.trim().length < 2) throw new ErroApi(400, 'Informe o nome do indicador (ao menos 2 letras)')
      d.nome = e.nome.trim().replace(/\s+/g, ' ')
    }
    if ('whatsapp' in e) {
      const bruto = (e.whatsapp ?? '').trim()
      if (!bruto) d.whatsapp = null
      else {
        const f = normalizarFone(bruto)
        if (!f) throw new ErroApi(400, 'WhatsApp inválido. Use DDD + número, por exemplo (11) 98812-4410')
        d.whatsapp = f
      }
    }
    if ('chavePix' in e) d.chavePix = (e.chavePix ?? '').trim() || null
    return d
  }

  const opcoesPermitidas = (s: Sessao) => { if (s.perfil !== 'ADMIN' && s.perfil !== 'VENDEDOR') throw new ErroApi(403, 'Você não tem acesso à lista de indicadores', 'SEM_PERMISSAO') }

  return {
    _interno: {
      ativo: (id) => { const r = registros.find((x) => x.id === id && x.ativo); return r ? { id: r.id, nome: r.nome, pct: r.pct } : null },
      contarOperacao(id) { novas.set(id, (novas.get(id) ?? 0) + 1); sincronizar() },
    },
    async opcoes(s) { opcoesPermitidas(s); return registros.filter((r) => r.ativo).map((r) => ({ id: r.id, nome: r.nome })) },
    async listar(s) { admin(s); return registros.map(visao).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')) },
    async obter(s, id) { admin(s); return visao(achar(id)) },

    async criar(s, e) {
      admin(s)
      const d = lerCampos(e, false)
      if (e.automatico && 'pct' in e) throw new ErroApi(400, 'Informe o % ou "automático", não os dois')
      const r: Registro = { id: ++proximoId, nome: d.nome!, whatsapp: d.whatsapp ?? null, chavePix: d.chavePix ?? null, pct: 0, pctManual: !e.automatico, ativo: true, email: null }
      r.pct = e.automatico ? pctDoNivel(0) : lerPct(e.pct)
      registros.push(r)
      return visao(r)
    },

    async atualizar(s, id, e) {
      admin(s)
      const r = achar(id)
      const d = lerCampos(e, true)
      if ('pct' in e && e.automatico) throw new ErroApi(400, 'Informe o % ou "automático", não os dois')
      if ('pct' in e) { d.pct = lerPct(e.pct); d.pctManual = true }
      else if (e.automatico) { d.pct = pctDoNivel(operacoesDe(id)); d.pctManual = false }
      Object.assign(r, d)
      if ('ativo' in e) {
        if (typeof e.ativo !== 'boolean') throw new ErroApi(400, 'ativo deve ser verdadeiro ou falso')
        r.ativo = e.ativo
      }
      return visao(r)
    },

    async criarAcesso(s, id, email): Promise<AcessoCriado> {
      admin(s)
      const r = achar(id)
      if (!r.ativo) throw new ErroApi(400, 'Reative o indicador antes de criar o acesso')
      if (r.email) throw new ErroApi(409, 'Este indicador já tem acesso', 'ACESSO_EXISTENTE')
      const e = email.trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw new ErroApi(400, 'E-mail inválido')
      if (registros.some((x) => x.email === e)) throw new ErroApi(409, 'Já existe um usuário com esse e-mail', 'EMAIL_EM_USO')
      r.email = e
      // no modo demonstração a senha é só para ver como fica; o login falso não a reconhece
      const bytes = crypto.getRandomValues(new Uint8Array(10))
      return { email: e, senhaTemporaria: btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 13) }
    },

    async niveis(s) { admin(s); return { niveis: niveis.map((n) => ({ ...n })), auto } },

    async salvarNiveis(s, t): Promise<TabelaNiveis> {
      admin(s)
      if (t.niveis.length !== niveis.length) throw new ErroApi(400, 'Envie todos os níveis')
      const novos = niveis.map((a) => {
        const n = t.niveis.find((x) => x.id === a.id)
        if (!n) throw new ErroApi(400, `Falta o nível ${a.nome}`)
        return { ...a, minOperacoes: n.minOperacoes, pct: n.pct }
      })
      const erro = validarNiveis(novos.map((n) => ({ id: n.id, nome: n.nome, min: n.minOperacoes, pct: n.pct })).sort((a, b) => a.min - b.min))
      if (erro) throw new ErroApi(400, erro)
      niveis = novos
      auto = t.auto
      sincronizar()
      return { niveis: niveis.map((n) => ({ ...n })), auto }
    },
  }
}
