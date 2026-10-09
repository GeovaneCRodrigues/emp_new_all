import { criarSeed } from '@/data/seed'
import { imeiValido, soDigitos } from '@/domain/documentos'
import type { Sessao } from '@/domain/escopo'
import { ErroApi } from './clientes'
import type { AparelhoApi, EntradaAparelho, EstadoAparelho, EstoqueApi, ResumoEstoqueApi } from './estoque'

type Registro = Required<Omit<AparelhoApi, 'paraCliente'>> & { paraClienteId: number | null }

/**
 * Versão de demonstração: guarda tudo na memória e aplica as mesmas regras do backend
 * (só o admin edita, vendedor sem custo, IMEI válido e único, estado e encomenda, vendido só leitura).
 */
/** Ganchos só da demonstração: a venda de mentira marca o aparelho como vendido e recebe a troca no estoque. */
export interface EstoqueFake extends EstoqueApi {
  _interno: {
    travar(id: number): { id: number; modelo: string; gb: number; cor: string; estado: EstadoAparelho; custo: number; extras: number; preco: number; paraClienteId: number | null } | null
    marcarVendido(id: number): void
    /** Retomada: o aparelho volta ao estoque disponível, sem encomenda, com a data de hoje. */
    devolver(id: number, dia: string, nota: string): void
    receberTroca(d: { modelo: string; gb: number; cor: string; bateria: number; imei: string | null; custo: number; preco: number }): void
  }
}

export function criarEstoqueFake(): EstoqueFake {
  const seed = criarSeed()
  let proximoId = 1000
  const nomeCliente = (id: number | null) => (id ? (seed.clientes.find((c) => c.id === id)?.nome ?? '') : '')
  const registros: Registro[] = seed.bens.map((b) => ({
    id: b.id, modelo: b.modelo, gb: b.gb, cor: b.cor, bateria: b.bateria, condicao: b.cond, imei: b.imei ? soDigitos(b.imei) : null,
    preco: b.preco, estado: b.estado, origem: b.origem, dataCompra: b.desde, custo: b.custo, extras: b.extras, observacoes: null,
    paraClienteId: b.paraCliente ?? null,
  }))

  const ver = (s: Sessao) => { if (s.perfil !== 'ADMIN' && s.perfil !== 'VENDEDOR') throw new ErroApi(403, 'Você não tem acesso ao estoque', 'SEM_PERMISSAO') }
  const admin = (s: Sessao) => { if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Só o administrador cadastra e edita aparelhos', 'SEM_PERMISSAO') }
  const visivel = (s: Sessao, r: Registro) => s.perfil === 'ADMIN' || r.estado !== 'VENDIDO'
  const naCarteira = (s: Sessao, clienteId: number | null) => !!clienteId && seed.clientes.some((c) => c.id === clienteId && c.responsavelId === s.usuarioId)

  const visao = (s: Sessao, r: Registro): AparelhoApi => {
    const cliente = r.paraClienteId && (s.perfil === 'ADMIN' || naCarteira(s, r.paraClienteId)) ? { id: r.paraClienteId, nome: nomeCliente(r.paraClienteId) } : null
    const base: AparelhoApi = {
      id: r.id, modelo: r.modelo, gb: r.gb, cor: r.cor, bateria: r.bateria, condicao: r.condicao, imei: r.imei, preco: r.preco,
      estado: r.estado, origem: r.origem, dataCompra: r.dataCompra, paraCliente: cliente,
    }
    return s.perfil === 'ADMIN' ? { ...base, custo: r.custo, extras: r.extras, observacoes: r.observacoes } : base
  }

  const erro = (m: string) => new ErroApi(400, m)
  const texto = (e: EntradaAparelho, c: 'modelo' | 'cor', min: number, max: number) => {
    const v = e[c]
    if (typeof v !== 'string' || v.trim().length < min) throw erro(`Informe ${c} (ao menos ${min} letras)`)
    if (v.trim().length > max) throw erro(`${c} pode ter no máximo ${max} caracteres`)
    return v.trim().replace(/\s+/g, ' ')
  }
  const dinheiro = (e: EntradaAparelho, c: 'custo' | 'extras' | 'preco', positivo: boolean) => {
    const v = e[c]
    if (typeof v !== 'number' || !Number.isFinite(v) || v > 1e8 || (positivo ? v <= 0 : v < 0)) throw erro(positivo ? `${c} precisa ser maior que zero` : `${c} não pode ser negativo`)
    return Math.round(v * 100) / 100
  }

  function lerDados(e: EntradaAparelho, parcial: boolean): Partial<Registro> {
    const d: Partial<Registro> = {}
    const tem = (c: keyof EntradaAparelho) => !parcial || c in e
    if (tem('modelo')) d.modelo = texto(e, 'modelo', 2, 80)
    if (tem('gb')) { if (typeof e.gb !== 'number' || !Number.isInteger(e.gb) || e.gb < 8 || e.gb > 4096) throw erro('gb precisa ser um número inteiro entre 8 e 4096'); d.gb = e.gb }
    if (tem('cor')) d.cor = texto(e, 'cor', 2, 40)
    if ('bateria' in e || !parcial) {
      const b = 'bateria' in e ? e.bateria : 100
      if (typeof b !== 'number' || !Number.isInteger(b) || b < 0 || b > 100) throw erro('bateria precisa ser um número inteiro entre 0 e 100')
      d.bateria = b
    }
    if ('condicao' in e || !parcial) {
      const c = 'condicao' in e ? e.condicao : 'Seminovo'
      if (c !== 'Novo' && c !== 'Seminovo') throw erro('condicao deve ser Novo ou Seminovo')
      d.condicao = c
    }
    if ('origem' in e || !parcial) {
      const o = 'origem' in e ? e.origem : 'COMPRA'
      if (o !== 'COMPRA' && o !== 'TROCA') throw erro('origem deve ser COMPRA ou TROCA')
      d.origem = o
    }
    if ('custo' in e || !parcial) d.custo = 'custo' in e ? dinheiro(e, 'custo', false) : 0
    if ('extras' in e || !parcial) d.extras = 'extras' in e ? dinheiro(e, 'extras', false) : 0
    if (tem('preco')) d.preco = dinheiro(e, 'preco', true)
    if ('dataCompra' in e) {
      if (typeof e.dataCompra !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.dataCompra) || new Date(e.dataCompra + 'T12:00:00Z').toISOString().slice(0, 10) !== e.dataCompra) throw erro('dataCompra precisa ser uma data válida (AAAA-MM-DD)')
      d.dataCompra = e.dataCompra
    } else if (!parcial) d.dataCompra = seed.hoje
    if ('imei' in e) {
      if (e.imei === null || e.imei === '') d.imei = null
      else if (typeof e.imei !== 'string' || !imeiValido(e.imei)) throw erro('IMEI inválido. Confira os 15 dígitos')
      else d.imei = soDigitos(e.imei)
    } else if (!parcial) d.imei = null
    if ('observacoes' in e) {
      if (e.observacoes && e.observacoes.length > 500) throw erro('observacoes pode ter no máximo 500 caracteres')
      d.observacoes = e.observacoes?.trim() || null
    } else if (!parcial) d.observacoes = null
    return d
  }

  function aplicarEstado(e: EntradaAparelho, d: Partial<Registro>, atual: Registro | null) {
    const estado = ('estado' in e ? e.estado : (atual?.estado ?? 'DISPONIVEL')) as EstadoAparelho
    if (!['DISPONIVEL', 'ENCOMENDADO', 'VENDIDO'].includes(estado)) throw erro('estado inválido')
    if (estado === 'VENDIDO') throw erro('O estado "vendido" muda só pela venda, não pela edição do aparelho')
    d.estado = estado
    const cliente = 'paraClienteId' in e ? e.paraClienteId : (atual?.paraClienteId ?? null)
    if (estado === 'ENCOMENDADO') {
      if (typeof cliente !== 'number' || !seed.clientes.some((c) => c.id === cliente)) throw erro('Escolha o cliente que encomendou')
      d.paraClienteId = cliente
    } else {
      if ('paraClienteId' in e && e.paraClienteId !== null) throw erro('Só aparelho encomendado tem cliente')
      d.paraClienteId = null
    }
  }

  const imeiEmUso = (imei: string, exceto?: number) => registros.some((r) => r.imei === imei && r.id !== exceto)
  const duplicado = () => new ErroApi(409, 'Já existe um aparelho com esse IMEI', 'IMEI_DUPLICADO')

  return {
    _interno: {
      travar: (id) => registros.find((r) => r.id === id) ?? null,
      marcarVendido(id) { const r = registros.find((x) => x.id === id); if (r) { r.estado = 'VENDIDO'; r.paraClienteId = null } },
      devolver(id, dia, nota) { const r = registros.find((x) => x.id === id); if (r) { r.estado = 'DISPONIVEL'; r.paraClienteId = null; r.dataCompra = dia; r.observacoes = r.observacoes ? `${r.observacoes}\n${nota}` : nota } },
      receberTroca(d) {
        registros.push({ id: ++proximoId, modelo: d.modelo, gb: d.gb, cor: d.cor, bateria: d.bateria, condicao: 'Seminovo', imei: d.imei, preco: d.preco, estado: 'DISPONIVEL', origem: 'TROCA', dataCompra: seed.hoje, custo: d.custo, extras: 0, observacoes: null, paraClienteId: null })
      },
    },
    async listar(s, q) {
      ver(s)
      if (q.estado && !['DISPONIVEL', 'ENCOMENDADO', 'VENDIDO'].includes(q.estado)) throw erro('estado inválido')
      const limite = Math.min(Math.max(q.limite ?? 20, 1), 100)
      const pagina = Math.max(q.pagina ?? 1, 1)
      const txt = (q.busca ?? '').trim().toLowerCase()
      const dig = soDigitos(txt)
      const achados = registros
        .filter((r) => visivel(s, r) && (!q.estado || r.estado === q.estado))
        .filter((r) => !txt || `${r.modelo} ${r.gb} gb ${r.cor}`.toLowerCase().includes(txt) || (dig.length >= 3 && (r.imei ?? '').includes(dig)))
        .sort((a, b) => b.dataCompra.localeCompare(a.dataCompra) || b.id - a.id)
      return { itens: achados.slice((pagina - 1) * limite, pagina * limite).map((r) => visao(s, r)), total: achados.length, pagina, limite }
    },
    async resumo(s): Promise<ResumoEstoqueApi> {
      ver(s)
      const disp = registros.filter((r) => r.estado === 'DISPONIVEL')
      const base = { disponiveis: disp.length, encomendados: registros.filter((r) => r.estado === 'ENCOMENDADO').length, valorEmVitrine: disp.reduce((x, r) => x + r.preco, 0) }
      if (s.perfil !== 'ADMIN') return base
      return { ...base, capitalParado: disp.reduce((x, r) => x + r.custo + r.extras, 0), margemMedia: disp.length ? disp.reduce((x, r) => x + (r.preco - r.custo - r.extras) / r.preco, 0) / disp.length : 0 }
    },
    async obter(s, id) {
      ver(s)
      const r = registros.find((x) => x.id === id)
      if (!r || !visivel(s, r)) throw new ErroApi(404, 'Aparelho não encontrado', 'NAO_ENCONTRADO')
      return visao(s, r)
    },
    async criar(s, e) {
      admin(s)
      const d = lerDados(e, false) as Registro
      aplicarEstado(e, d, null)
      if (d.imei && imeiEmUso(d.imei)) throw duplicado()
      const novo: Registro = { ...d, id: ++proximoId }
      registros.push(novo)
      return visao(s, novo)
    },
    async atualizar(s, id, e) {
      admin(s)
      const r = registros.find((x) => x.id === id)
      if (!r) throw new ErroApi(404, 'Aparelho não encontrado', 'NAO_ENCONTRADO')
      if (r.estado === 'VENDIDO') throw new ErroApi(409, 'Aparelho vendido não pode ser alterado', 'APARELHO_VENDIDO')
      // reenviar o IMEI já cadastrado não é mudança (dados antigos podem não passar no dígito verificador)
      const corpo: EntradaAparelho = { ...e }
      if (typeof e.imei === 'string' && soDigitos(e.imei) === r.imei) delete corpo.imei
      const d = lerDados(corpo, true)
      if ('estado' in e || 'paraClienteId' in e) aplicarEstado(e, d, r)
      if (d.imei && d.imei !== r.imei && imeiEmUso(d.imei, id)) throw duplicado()
      Object.assign(r, d)
      return visao(s, r)
    },
  }
}
