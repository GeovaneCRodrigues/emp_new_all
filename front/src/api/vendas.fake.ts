import { criarSeed } from '@/data/seed'
import { imeiValido, soDigitos } from '@/domain/documentos'
import { arred2, ceilCent } from '@/domain/format'
import { somaMes } from '@/domain/datas'
import type { Sessao } from '@/domain/escopo'
import { ErroApi, type ClientesApi } from './clientes'
import type { EstoqueFake } from './estoque.fake'
import type { IndicadoresFake } from './indicadores.fake'
import type { EntradaVenda, FormaPagamentoApi, JurosApi, StatusVenda, VendaApi, VendasApi } from './vendas'

interface Parcela { numero: number; vencimento: string; valor: number; desconto: number; pago: number }
interface Registro {
  id: number; aparelho: VendaApi['aparelho']; cliente: VendaApi['cliente']; vendedorId: number | null; indicador: VendaApi['indicador']; pct: number
  dataVenda: string; precoAcordado: number; entrada: number; troca: number; jurosPct: number; investido: number; status: StatusVenda
  contrato: VendaApi['contrato']; parcelas: Parcela[]
}

const FORMAS: FormaPagamentoApi[] = ['PIX', 'DINHEIRO', 'CARTAO']
const MARGEM_REVENDA = 1.25
const JUROS: JurosApi = { pct: 10, maxParcelas: 10 }

interface Dependencias { estoque: EstoqueFake; indicadores: IndicadoresFake; clientes: ClientesApi }

/**
 * Versão de demonstração: o servidor de mentira refaz as contas como o de verdade (juros por parcela,
 * % do indicador congelado, custo gravado no dia, vendedor sem lucro) e conversa com o estoque e os
 * indicadores de demonstração (aparelho vira vendido, contador do indicador anda).
 */
export function criarVendasFake(dep: Dependencias): VendasApi {
  const seed = criarSeed()
  const hoje = seed.hoje
  let proximoId = 1000

  const registros: Registro[] = seed.vendas.map((v) => {
    const b = seed.bens.find((x) => x.id === v.bemId)!
    const ind = seed.indicadores.find((i) => i.id === v.indicadorId)
    const cli = seed.clientes.find((c) => c.id === v.clienteId)!
    return {
      id: v.id, aparelho: { id: b.id, modelo: b.modelo, gb: b.gb, cor: b.cor }, cliente: { id: cli.id, nome: cli.nome }, vendedorId: cli.responsavelId,
      indicador: ind ? { id: ind.id, nome: ind.nome } : null, pct: v.pct, dataVenda: v.data, precoAcordado: b.preco, entrada: v.entrada, troca: v.troca,
      jurosPct: 10, investido: b.custo + b.extras, status: v.status, contrato: v.contrato,
      parcelas: v.parcelas.map((p) => ({ numero: p.n, vencimento: p.venc, valor: p.valor, desconto: p.desconto, pago: p.pagos.reduce((s, g) => s + g.valor, 0) })),
    }
  })

  const clientesDe = (r: Registro, s: Sessao) => (s.perfil === 'VENDEDOR' ? r.vendedorId === s.usuarioId || seed.clientes.find((c) => c.id === r.cliente.id)?.responsavelId === s.usuarioId : seed.clientes.find((c) => c.id === r.cliente.id)?.responsavelId === s.usuarioId)
  const noEscopo = (s: Sessao) => (s.perfil === 'ADMIN' ? registros : registros.filter((r) => clientesDe(r, s)))

  function calcular(r: Registro, perfil: Sessao['perfil']): VendaApi {
    const totalParc = r.parcelas.reduce((x, p) => x + p.valor, 0)
    const total = arred2(r.entrada + r.troca + totalParc)
    const recebido = arred2(r.entrada + r.troca + r.parcelas.reduce((x, p) => x + p.pago, 0))
    const descontos = arred2(r.parcelas.reduce((x, p) => x + p.desconto, 0))
    const falta = arred2(total - recebido - descontos)
    const abertas = r.parcelas.filter((p) => arred2(p.valor - p.pago - p.desconto) > 0.009)
    const lucroTotal = arred2(total - r.investido)
    const status: StatusVenda = r.status === 'RETOMADA' || r.status === 'CANCELADA' ? r.status : falta <= 0.009 ? 'QUITADA' : 'ATIVA'
    const base: VendaApi = {
      id: r.id, aparelho: r.aparelho, cliente: r.cliente, indicador: r.indicador, dataVenda: r.dataVenda, precoAcordado: r.precoAcordado, entrada: r.entrada,
      troca: r.troca, jurosPct: r.jurosPct, nParcelas: r.parcelas.length, valorParcela: r.parcelas[0]?.valor ?? 0, total, recebido, falta,
      atrasadas: abertas.filter((p) => p.vencimento < hoje).length, status, contrato: r.contrato,
      parcelas: r.parcelas.map((p) => ({ numero: p.numero, vencimento: p.vencimento, vencimentoOriginal: null, valor: p.valor, desconto: p.desconto, pago: p.pago, falta: arred2(p.valor - p.pago - p.desconto), quitadaEm: arred2(p.valor - p.pago - p.desconto) <= 0.009 ? p.vencimento : null })),
    }
    if (perfil !== 'ADMIN') return base
    return {
      ...base, custoNoDia: r.investido, lucroTotal, capitalDeVolta: arred2(Math.min(r.investido, recebido)),
      lucroRealizado: arred2(Math.max(0, recebido - r.investido) * (1 - r.pct)), seuLucro: arred2(lucroTotal > 0 ? lucroTotal * (1 - r.pct) : lucroTotal),
      percentualIndicador: r.pct, parteIndicador: arred2(lucroTotal > 0 ? lucroTotal * r.pct : 0),
    }
  }

  const ver = (s: Sessao) => { if (s.perfil !== 'ADMIN' && s.perfil !== 'VENDEDOR' && s.perfil !== 'COBRADOR') throw new ErroApi(403, 'Você não tem acesso às vendas', 'SEM_PERMISSAO') }
  const erro = (m: string) => new ErroApi(400, m)
  const inteiro = (v: unknown, c: string, min: number, max: number) => { if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw erro(`${c} precisa ser um número inteiro entre ${min} e ${max}`); return v }
  const dinheiro = (v: unknown, c: string, positivo = false) => { if (typeof v !== 'number' || !Number.isFinite(v) || v > 1e8 || (positivo ? v <= 0 : v < 0)) throw erro(positivo ? `${c} precisa ser maior que zero` : `${c} não pode ser negativo`); return arred2(v) }

  return {
    async juros(s) {
      if (s.perfil !== 'ADMIN' && s.perfil !== 'VENDEDOR') throw new ErroApi(403, 'Você não tem acesso a esta configuração', 'SEM_PERMISSAO')
      return { ...JUROS }
    },

    async criar(s, e: EntradaVenda) {
      if (s.perfil !== 'ADMIN' && s.perfil !== 'VENDEDOR') throw new ErroApi(403, 'Só o administrador e o vendedor vendem', 'SEM_PERMISSAO')
      const aparelhoId = inteiro(e.aparelhoId, 'aparelhoId', 1, 2 ** 31 - 1)
      const clienteId = inteiro(e.clienteId, 'clienteId', 1, 2 ** 31 - 1)
      const entrada = 'entrada' in e && e.entrada !== undefined ? dinheiro(e.entrada, 'entrada') : 0
      if (e.formaEntrada !== undefined && !FORMAS.includes(e.formaEntrada)) throw erro('formaEntrada deve ser PIX, DINHEIRO ou CARTAO')
      const n = e.parcelas !== undefined ? inteiro(e.parcelas, 'parcelas', 0, JUROS.maxParcelas) : 0
      const dia = n > 0 ? inteiro(e.diaVencimento, 'diaVencimento', 1, 31) : 1
      if (s.perfil === 'VENDEDOR' && e.vendedorId != null) throw new ErroApi(403, 'O vendedor vende sempre em nome dele', 'SEM_PERMISSAO')

      let troca: { modelo: string; gb: number; cor: string; bateria: number; imei: string | null; valor: number; precoRevenda: number | null } | null = null
      if (e.troca) {
        const t = e.troca
        const txt = (c: 'modelo' | 'cor', min: number, max: number) => { const v = t[c]; if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max) throw erro(`troca: informe ${c}`); return v.trim().replace(/\s+/g, ' ') }
        let imei: string | null = null
        if (t.imei) { if (!imeiValido(t.imei)) throw erro('troca: IMEI inválido'); imei = soDigitos(t.imei) }
        troca = { modelo: txt('modelo', 2, 80), cor: txt('cor', 2, 40), gb: inteiro(t.gb, 'troca.gb', 8, 4096), bateria: inteiro(t.bateria, 'troca.bateria', 0, 100), imei, valor: dinheiro(t.valor, 'troca.valor', true), precoRevenda: t.precoRevenda ? dinheiro(t.precoRevenda, 'troca.precoRevenda', true) : null }
      }

      const ap = dep.estoque._interno.travar(aparelhoId)
      if (!ap) throw new ErroApi(404, 'Aparelho não encontrado', 'NAO_ENCONTRADO')
      if (ap.estado === 'VENDIDO') throw new ErroApi(409, 'Este aparelho já não está disponível para venda', 'APARELHO_INDISPONIVEL')
      const cliente = await dep.clientes.obter(s, clienteId).catch(() => null)
      if (!cliente) throw new ErroApi(404, 'Cliente não encontrado', 'NAO_ENCONTRADO')
      if (ap.estado === 'ENCOMENDADO' && ap.paraClienteId !== cliente.id) throw new ErroApi(409, 'Este aparelho está encomendado para outro cliente', 'APARELHO_ENCOMENDADO')

      const preco = e.preco !== undefined ? dinheiro(e.preco, 'preco', true) : ap.preco
      if (s.perfil === 'VENDEDOR' && preco < ap.preco) throw new ErroApi(403, 'Só o administrador vende abaixo do preço de tabela', 'SEM_PERMISSAO')
      const trocaValor = troca?.valor ?? 0
      if (arred2(entrada + trocaValor) > preco) throw erro('A entrada mais a troca não podem passar do preço')
      const parcelado = arred2(preco - entrada - trocaValor)
      if (parcelado > 0 && n < 1) throw erro('Informe em quantas parcelas o restante será pago')
      if (parcelado === 0 && n > 0) throw erro('Não sobra nada para parcelar: tire as parcelas ou diminua a entrada')

      let indicador: { id: number; nome: string; pct: number } | null = null
      if (e.indicadorId != null) {
        indicador = dep.indicadores._interno.ativo(e.indicadorId)
        if (!indicador) throw erro('Indicador não encontrado ou desativado')
      }

      const parc = n > 0 ? ceilCent(arred2(parcelado * (1 + (JUROS.pct / 100) * n)) / n) : 0
      if (troca) dep.estoque._interno.receberTroca({ modelo: troca.modelo, gb: troca.gb, cor: troca.cor, bateria: troca.bateria, imei: troca.imei, custo: troca.valor, preco: troca.precoRevenda ?? arred2(troca.valor * MARGEM_REVENDA) })
      const reg: Registro = {
        id: ++proximoId, aparelho: { id: ap.id, modelo: ap.modelo, gb: ap.gb, cor: ap.cor }, cliente: { id: cliente.id, nome: cliente.nome },
        vendedorId: s.perfil === 'VENDEDOR' ? (s.usuarioId ?? null) : (e.vendedorId ?? null), indicador: indicador ? { id: indicador.id, nome: indicador.nome } : null,
        pct: indicador?.pct ?? 0, dataVenda: hoje, precoAcordado: preco, entrada, troca: trocaValor, jurosPct: JUROS.pct, investido: arred2(ap.custo + ap.extras),
        status: parcelado === 0 ? 'QUITADA' : 'ATIVA', contrato: 'AGUARDANDO',
        parcelas: Array.from({ length: n }, (_, i) => ({ numero: i + 1, vencimento: somaMes(hoje, i + 1, dia), valor: parc, desconto: 0, pago: 0 })),
      }
      registros.push(reg)
      dep.estoque._interno.marcarVendido(ap.id)
      if (indicador) dep.indicadores._interno.contarOperacao(indicador.id)
      return calcular(reg, s.perfil)
    },

    async listar(s, q) {
      ver(s)
      if (q.status && !['ATIVA', 'ATRASO', 'QUITADA', 'RETOMADA'].includes(q.status)) throw erro('status inválido')
      const limite = Math.min(Math.max(q.limite ?? 20, 1), 100)
      const pagina = Math.max(q.pagina ?? 1, 1)
      const todas = noEscopo(s).slice().sort((a, b) => b.dataVenda.localeCompare(a.dataVenda) || b.id - a.id).map((r) => calcular(r, s.perfil))
      const filtradas = todas.filter((v) => !q.status || (q.status === 'ATRASO' ? v.status === 'ATIVA' && v.atrasadas > 0 : v.status === q.status))
      return { itens: filtradas.slice((pagina - 1) * limite, pagina * limite), total: filtradas.length, pagina, limite }
    },

    async obter(s, id) {
      ver(s)
      const r = noEscopo(s).find((x) => x.id === id)
      if (!r) throw new ErroApi(404, 'Venda não encontrada', 'NAO_ENCONTRADO')
      return calcular(r, s.perfil)
    },

    async resumo(s) {
      ver(s)
      const ativas = noEscopo(s).map((r) => ({ r, c: calcular(r, 'ADMIN') })).filter(({ c }) => c.status === 'ATIVA')
      const aReceber = arred2(ativas.reduce((x, { c }) => x + c.falta, 0))
      if (s.perfil !== 'ADMIN') return { aReceber }
      return {
        aReceber, capitalNaRua: arred2(ativas.reduce((x, { r, c }) => x + (r.investido - c.capitalDeVolta!), 0)),
        lucroPorVir: arred2(ativas.reduce((x, { c }) => x + Math.max(0, c.seuLucro! - c.lucroRealizado!), 0)),
      }
    },
  }
}
