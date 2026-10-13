import { termoBusca } from '../../../shared/busca.js'
import { HttpError, naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import { imeiValido, soDigitos } from '../../../shared/documentos.js'
import type { Sessao } from '../../../shared/perfis.js'
import { hojeBR } from '../../../shared/relogio.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import type { ConfigRepository } from '../../config/models/repository.js'
import type { VendasRepository } from '../models/repository.js'
import type { EscopoVendas, FormaPagamento, NovaTroca, Venda } from '../models/types.js'
import { arred2, planoParc, vencimentos } from './calculo.js'
import { contas } from './contas.js'

export type Entrada = Record<string, unknown>
export type VendaCalculada = { venda: Venda } & ReturnType<typeof contas>
export type FiltroVendas = { status?: string; busca?: string; pagina?: number; limite?: number }
export type ResultadoLista = { itens: VendaCalculada[]; total: number; pagina: number; limite: number }
export type ResumoVendas = { aReceber: number; capitalNaRua: number; lucroPorVir: number }

export type VendasService = {
  criar(s: Sessao, e: Entrada): Promise<VendaCalculada>
  listar(s: Sessao, f: FiltroVendas): Promise<ResultadoLista>
  obter(s: Sessao, id: number): Promise<VendaCalculada>
  resumo(s: Sessao): Promise<ResumoVendas>
  /** Retoma o aparelho de uma venda com parcela atrasada (só o administrador; o cobrador pede em /aprovacoes). */
  retomar(s: Sessao, id: number, e: Entrada): Promise<VendaCalculada>
}

const FORMAS: FormaPagamento[] = ['PIX', 'DINHEIRO', 'CARTAO']
const LIMITE_MAX = 100
const DINHEIRO_MAX = 100_000_000
const MARGEM_REVENDA = 1.25

const APARELHO_INDISPONIVEL = new HttpError(409, 'Este aparelho já não está disponível para venda', 'APARELHO_INDISPONIVEL')
const IMEI_DUPLICADO = new HttpError(409, 'Já existe um aparelho com esse IMEI', 'IMEI_DUPLICADO')

export function escopoDe(s: Sessao): EscopoVendas {
  if (s.perfil === 'ADMIN') return { tipo: 'TODOS' }
  if (s.perfil === 'VENDEDOR') return { tipo: 'VENDEDOR', usuarioId: s.usuarioId }
  if (s.perfil === 'INDICADOR') return { tipo: 'INDICADOR', indicadorId: s.indicadorId ?? -1 }
  return { tipo: 'CARTEIRA', usuarioId: s.usuarioId }
}

const inteiro = (v: unknown, campo: string, min: number, max: number) => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw requisicaoInvalida(`${campo} precisa ser um número inteiro entre ${min} e ${max}`)
  return v
}
const dinheiro = (v: unknown, campo: string, positivo = false) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v > DINHEIRO_MAX || (positivo ? v <= 0 : v < 0)) throw requisicaoInvalida(positivo ? `${campo} precisa ser maior que zero` : `${campo} não pode ser negativo`)
  return arred2(v)
}

export type Dependencias = {
  vendas: VendasRepository
  config: ConfigRepository
  auditoria: AuditoriaRepository
  /** Depois de vender, o indicador pode ter subido de nível (o % dos automáticos acompanha). */
  sincronizarNiveis: () => Promise<void>
  /** Depois de vender, gera o contrato da venda (se falhar, a venda já está salva e o contrato se gera depois). */
  gerarContrato?: (vendaId: number, usuarioId: number) => Promise<void>
  /** Para os testes fixarem o dia. */
  hoje?: () => string
  log?: (msg: string, err: unknown) => void
}

export function createVendasService(d: Dependencias): VendasService {
  const hoje = d.hoje ?? (() => hojeBR())
  const calcular = (v: Venda): VendaCalculada => ({
    venda: v,
    ...contas({ entrada: v.entrada, troca: v.troca, investido: v.investido, pct: v.pct, statusGravado: v.status, parcelas: v.parcelas.map((p) => ({ valor: p.valor, desconto: p.desconto, pago: p.pago, vencimento: p.vencimento })) }, hoje()),
  })

  function exigirVer(s: Sessao) {
    if (s.perfil !== 'ADMIN' && s.perfil !== 'VENDEDOR' && s.perfil !== 'COBRADOR' && s.perfil !== 'INDICADOR') throw semPermissao('Você não tem acesso às vendas')
  }

  /** Lê e valida o corpo do pedido. Nada que vem da tela (totais, parcelas) é confiado: o servidor refaz as contas. */
  function lerEntrada(e: Entrada, maxParcelas: number) {
    const aparelhoId = inteiro(e.aparelhoId, 'aparelhoId', 1, 2 ** 31 - 1)
    const clienteId = inteiro(e.clienteId, 'clienteId', 1, 2 ** 31 - 1)
    const entrada = 'entrada' in e ? dinheiro(e.entrada, 'entrada') : 0
    let forma: FormaPagamento = 'PIX'
    if ('formaEntrada' in e) {
      if (!FORMAS.includes(e.formaEntrada as FormaPagamento)) throw requisicaoInvalida('formaEntrada deve ser PIX, DINHEIRO ou CARTAO')
      forma = e.formaEntrada as FormaPagamento
    }

    let troca: (Omit<NovaTroca, 'preco' | 'dataCompra'> & { precoRevenda: number | null }) | null = null
    if (e.troca !== undefined && e.troca !== null) {
      const t = e.troca as Record<string, unknown>
      if (typeof t !== 'object') throw requisicaoInvalida('troca inválida')
      const texto = (c: string, min: number, max: number) => {
        const v = t[c]
        if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max) throw requisicaoInvalida(`troca: informe ${c}`)
        return v.trim().replace(/\s+/g, ' ')
      }
      let imei: string | null = null
      if (t.imei !== undefined && t.imei !== null && t.imei !== '') {
        if (typeof t.imei !== 'string' || !imeiValido(t.imei)) throw requisicaoInvalida('troca: IMEI inválido')
        imei = soDigitos(t.imei)
      }
      troca = {
        modelo: texto('modelo', 2, 80), cor: texto('cor', 2, 40), gb: inteiro(t.gb, 'troca.gb', 8, 4096), bateria: inteiro(t.bateria, 'troca.bateria', 0, 100),
        custo: dinheiro(t.valor, 'troca.valor', true), imei, precoRevenda: t.precoRevenda === undefined || t.precoRevenda === null ? null : dinheiro(t.precoRevenda, 'troca.precoRevenda', true),
      }
    }

    const preco = 'preco' in e && e.preco !== undefined ? dinheiro(e.preco, 'preco', true) : null
    const parcelas = 'parcelas' in e && e.parcelas !== undefined ? inteiro(e.parcelas, 'parcelas', 0, maxParcelas) : 0
    const dia = parcelas > 0 ? inteiro(e.diaVencimento, 'diaVencimento', 1, 31) : null
    const indicadorId = e.indicadorId === undefined || e.indicadorId === null ? null : inteiro(e.indicadorId, 'indicadorId', 1, 2 ** 31 - 1)
    const vendedorId = e.vendedorId === undefined || e.vendedorId === null ? null : inteiro(e.vendedorId, 'vendedorId', 1, 2 ** 31 - 1)
    return { aparelhoId, clienteId, entrada, forma, troca, preco, parcelas, dia, indicadorId, vendedorId }
  }

  const trataDuplicado = (err: unknown): never => {
    const e = err as { code?: string; constraint?: string }
    if (e?.code === '23505') throw e.constraint === 'vendas_bem_ativa_uq' ? APARELHO_INDISPONIVEL : IMEI_DUPLICADO
    throw err
  }

  const svc: VendasService = {
    async criar(s, corpo) {
      if (s.perfil !== 'ADMIN' && s.perfil !== 'VENDEDOR') throw semPermissao('Só o administrador e o vendedor vendem')
      const juros = await d.config.juros()
      const e = lerEntrada(corpo, juros.maxParcelas)
      if (s.perfil === 'VENDEDOR' && e.vendedorId !== null) throw semPermissao('O vendedor vende sempre em nome dele')
      const dataVenda = hoje()

      const vendaId = await d.vendas
        .emTransacao(async (tx) => {
          const ap = await tx.travarAparelho(e.aparelhoId)
          if (!ap) throw naoEncontrado('Aparelho não encontrado')
          if (ap.estado === 'VENDIDO') throw APARELHO_INDISPONIVEL

          const cliente = await tx.clienteNoEscopo(e.clienteId, escopoDe(s))
          if (!cliente) throw naoEncontrado('Cliente não encontrado')
          // aparelho encomendado é do cliente que encomendou
          if (ap.estado === 'ENCOMENDADO' && ap.clienteEncomendaId !== cliente.id) throw new HttpError(409, 'Este aparelho está encomendado para outro cliente', 'APARELHO_ENCOMENDADO')

          const preco = e.preco ?? ap.preco
          if (s.perfil === 'VENDEDOR' && preco < ap.preco) throw semPermissao('Só o administrador vende abaixo do preço de tabela')

          const trocaValor = e.troca?.custo ?? 0
          if (arred2(e.entrada + trocaValor) > preco) throw requisicaoInvalida('A entrada mais a troca não podem passar do preço')
          const parcelado = arred2(preco - e.entrada - trocaValor)
          if (parcelado > 0 && e.parcelas < 1) throw requisicaoInvalida('Informe em quantas parcelas o restante será pago')
          if (parcelado === 0 && e.parcelas > 0) throw requisicaoInvalida('Não sobra nada para parcelar: tire as parcelas ou diminua a entrada')

          let indicador: { id: number; nome: string; pct: number } | null = null
          if (e.indicadorId !== null) {
            indicador = await tx.indicadorAtivo(e.indicadorId)
            if (!indicador) throw requisicaoInvalida('Indicador não encontrado ou desativado')
          }
          let vendedorId: number | null = s.perfil === 'VENDEDOR' ? s.usuarioId : e.vendedorId
          if (vendedorId !== null && s.perfil === 'ADMIN' && !(await tx.vendedorValido(vendedorId))) throw requisicaoInvalida('Vendedor inválido')

          const plano = planoParc(parcelado, e.parcelas, juros.pct)
          const total = arred2(e.entrada + trocaValor + plano.totalParcelas)

          let trocaBemId: number | null = null
          if (e.troca) {
            // o aparelho que o cliente deu entra no estoque, custando o que foi aceito
            trocaBemId = await tx.criarAparelhoTroca({
              modelo: e.troca.modelo, gb: e.troca.gb, cor: e.troca.cor, bateria: e.troca.bateria, imei: e.troca.imei, custo: e.troca.custo,
              preco: e.troca.precoRevenda ?? arred2(e.troca.custo * MARGEM_REVENDA), dataCompra: dataVenda,
            })
          }
          const id = await tx.criarVenda({
            bemId: ap.id, clienteId: cliente.id, vendedorId, indicadorId: indicador?.id ?? null,
            // o % do indicador fica congelado nesta venda: mudar o indicador depois não altera vendas antigas
            pct: indicador?.pct ?? 0, dataVenda, precoAcordado: preco, entrada: e.entrada, troca: trocaValor, trocaBemId, jurosPct: juros.pct,
            // o custo do dia: corrigir o custo do aparelho depois não muda o lucro desta venda
            investido: arred2(ap.custo + ap.extras), total, status: parcelado === 0 ? 'QUITADA' : 'ATIVA',
          })
          const vcs = vencimentos(dataVenda, e.parcelas, e.dia ?? 1)
          await tx.criarParcelas(id, vcs.map((vencimento, i) => ({ numero: i + 1, vencimento, valor: plano.parc })))
          if (e.entrada > 0) {
            // o recibo da entrada mostra o que ficou combinado para pagar
            const resumo = { tipo: 'ENTRADA', referencia: 'entrada', faltaDepois: plano.totalParcelas, proxima: e.parcelas > 0 ? { numero: 1, valor: plano.parc, vencimento: vcs[0] } : null, restantes: e.parcelas, ficaDevendo: null }
            await tx.registrarEntrada({ vendaId: id, clienteId: cliente.id, valor: e.entrada, forma: e.forma, data: dataVenda, recebidoPor: s.usuarioId, resumo })
          }
          await tx.marcarVendido(ap.id)
          return id
        })
        .catch(trataDuplicado)

      const venda = (await d.vendas.buscar(vendaId, { tipo: 'TODOS' }))!
      const calc = calcular(venda)
      await d.auditoria.registrar({
        usuarioId: s.usuarioId, acao: 'VENDA_CRIADA', entidade: 'venda', entidadeId: vendaId,
        depois: { aparelhoId: venda.aparelho.id, clienteId: venda.cliente.id, indicadorId: venda.indicador?.id ?? null, pct: venda.pct, preco: venda.precoAcordado, entrada: venda.entrada, troca: venda.troca, parcelas: venda.parcelas.length, total: calc.total, investido: venda.investido },
      })
      // o contador de operações do indicador andou: o % dos automáticos acompanha o nível (se falhar, a venda já está salva)
      await d.sincronizarNiveis().catch((err) => d.log?.('Falha ao sincronizar os níveis dos indicadores', err))
      await d.gerarContrato?.(vendaId, s.usuarioId).catch((err) => d.log?.('Falha ao gerar o contrato da venda', err))
      // o contrato mexe no status da venda: devolve a venda já com ele
      return calcular((await d.vendas.buscar(vendaId, { tipo: 'TODOS' }))!)
    },

    async listar(s, f) {
      exigirVer(s)
      const limite = Math.min(Math.max(Math.trunc(f.limite ?? 20) || 20, 1), LIMITE_MAX)
      const pagina = Math.max(Math.trunc(f.pagina ?? 1) || 1, 1)
      if (f.status && !['ATIVA', 'ATRASO', 'QUITADA', 'RETOMADA'].includes(f.status)) throw requisicaoInvalida('status inválido')
      const todas = (await d.vendas.listar(escopoDe(s), termoBusca(f.busca))).map(calcular)
      const filtradas = todas.filter((c) => {
        if (!f.status) return true
        if (f.status === 'ATRASO') return c.status === 'ATIVA' && c.atrasadas > 0
        return c.status === f.status
      })
      return { itens: filtradas.slice((pagina - 1) * limite, pagina * limite), total: filtradas.length, pagina, limite }
    },

    async obter(s, id) {
      exigirVer(s)
      const v = await d.vendas.buscar(id, escopoDe(s))
      if (!v) throw naoEncontrado('Venda não encontrada')
      return calcular(v)
    },

    async retomar(s, id, e) {
      if (s.perfil !== 'ADMIN') throw semPermissao('Só o administrador retoma o aparelho (o cobrador pede a retomada)')
      let motivo: string | null = null
      if (e.motivo !== undefined && e.motivo !== null && e.motivo !== '') {
        if (typeof e.motivo !== 'string' || e.motivo.trim().length > 500) throw requisicaoInvalida('motivo: no máximo 500 letras')
        motivo = e.motivo.trim() || null
      }
      const antes = await d.vendas.buscar(id, { tipo: 'TODOS' })
      if (!antes) throw naoEncontrado('Venda não encontrada')
      const r = await d.vendas.retomar({ vendaId: id, usuarioId: s.usuarioId, motivo, dia: hoje() })
      await d.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'VENDA_RETOMADA', entidade: 'venda', entidadeId: id, antes: { status: antes.status }, depois: { status: 'RETOMADA', aparelhoId: r.bemId, emAberto: r.emAberto, parcelasAtrasadas: r.atrasadas, motivo } })
      return calcular((await d.vendas.buscar(id, { tipo: 'TODOS' }))!)
    },

    async resumo(s) {
      exigirVer(s)
      const ativas = (await d.vendas.listar(escopoDe(s))).map(calcular).filter((c) => c.status === 'ATIVA')
      return {
        aReceber: arred2(ativas.reduce((x, c) => x + c.falta, 0)),
        capitalNaRua: arred2(ativas.reduce((x, c) => x + (c.venda.investido - c.capitalDeVolta), 0)),
        lucroPorVir: arred2(ativas.reduce((x, c) => x + Math.max(0, c.seuLucro - c.lucroRealizado), 0)),
      }
    },
  }
  return svc
}
