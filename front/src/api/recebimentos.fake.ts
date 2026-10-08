import { criarSeed } from '@/data/seed'
import { addDia } from '@/domain/datas'
import { soDigitos } from '@/domain/documentos'
import type { Sessao } from '@/domain/escopo'
import { arred2 } from '@/domain/format'
import { calcularRecebimento, ErroRecebimento, falta, referencia, type ParcelaAberta } from '@/domain/recebimento'
import { ErroApi } from './clientes'
import type { AbaCobranca, CobrancaApi, PagamentoApi, ReciboApi, RecebimentosApi } from './recebimentos'
import type { FormaPagamentoApi } from './vendas'
import type { Registro, Transacao, VendasFake } from './vendas.fake'

const FORMAS: FormaPagamentoApi[] = ['PIX', 'DINHEIRO', 'CARTAO']
const NOME_FORMA: Record<FormaPagamentoApi, string> = { PIX: 'Pix', DINHEIRO: 'Dinheiro', CARTAO: 'Cartão' }
const ABAS: AbaCobranca[] = ['atrasadas', 'hoje', 'proximas', 'recebidas']
const HTTP: Record<ErroRecebimento['codigo'], number> = { PARCELA_INEXISTENTE: 404, PARCELA_PAGA: 409, VALOR_INVALIDO: 400, EXCEDE_DIVIDA: 400, RESTO_OBRIGATORIO: 400, VENCIMENTO_INVALIDO: 400 }

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const dmyA = (iso: string) => `${dmy(iso)}/${iso.slice(0, 4)}`
const brl = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const primeiroNome = (n: string) => n.trim().split(/\s+/)[0] || '—'
const dataValida = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v

/** O texto que vai para o WhatsApp do cliente (o mesmo que o backend monta). */
function mensagemRecibo(r: Omit<ReciboApi, 'mensagem'>): string {
  const empresa = r.empresa.nome.replace(/\s+LTDA\.?$/i, '')
  const prox = r.proxima
    ? `Próxima: ${r.proxima.numero}ª, ${brl(r.proxima.valor)}, vence ${dmy(r.proxima.vencimento)}. ${r.restantes === 1 ? 'Falta 1 parcela' : `Faltam ${r.restantes} parcelas`} (${brl(r.faltaDepois)}).`
    : 'Tudo quitado! Obrigado pela confiança.'
  const resto = r.ficaDevendo ? `\nNa ${r.ficaDevendo.numero}ª ainda ficam ${brl(r.ficaDevendo.valor)}, para ${dmy(r.ficaDevendo.vencimento)}.` : ''
  return `*${empresa}* · Recibo nº ${r.numero}\n\nOi ${primeiroNome(r.cliente.nome)}! Recebemos ${brl(r.valor)} em ${dmyA(r.data)} (${NOME_FORMA[r.forma]}), referente à ${r.referencia} do seu ${r.aparelho}.${resto}\n\n${prox}\n\nObrigado!`
}

/**
 * Versão de demonstração: mesmas regras do backend (quem pode, data, desconto só do admin,
 * desfazer só o último, cobranças por aba), sobre as mesmas vendas da demonstração.
 */
export function criarRecebimentosFake(vendas: VendasFake): RecebimentosApi {
  const { hoje, registros, transacoes } = vendas._interno
  const fones = new Map(criarSeed().clientes.map((c) => [c.id, soDigitos(c.fone)]))
  const foneDe = (id: number) => fones.get(id) ?? ''

  const permitido = (s: Sessao) => { if (s.perfil !== 'ADMIN' && s.perfil !== 'COBRADOR') throw new ErroApi(403, 'Só o administrador e o cobrador mexem com recebimentos', 'SEM_PERMISSAO') }
  const doEscopo = (s: Sessao, vendaId: number): Registro => {
    const r = vendas._interno.noEscopo(s).find((x) => x.id === vendaId)
    if (!r) throw new ErroApi(404, 'Venda não encontrada', 'NAO_ENCONTRADO')
    return r
  }
  const abertas = (r: Registro) => r.parcelas.filter((p) => falta(p) > 0.009)
  const comoAberta = (r: Registro): ParcelaAberta[] => r.parcelas.map((p) => ({ id: p.numero, numero: p.numero, vencimento: p.vencimento, vencimentoOriginal: p.vencimentoOriginal, valor: p.valor, desconto: p.desconto, pago: p.pago, quitadaEm: p.quitadaEm }))
  const registroDe = (t: Transacao) => registros.find((r) => r.id === t.vendaId)!

  function recibo(t: Transacao): ReciboApi {
    const r = registroDe(t)
    const base = {
      id: t.id, numero: String(t.numero).padStart(6, '0'), empresa: { nome: 'Mundo dos iPhones', cnpj: null }, cliente: { id: r.cliente.id, nome: r.cliente.nome, fone: foneDe(r.cliente.id) },
      aparelho: r.aparelho.modelo, valor: t.valor, forma: t.forma, data: t.data, recebidoPor: primeiroNome(t.recebidoPorNome), desfeita: t.desfeita,
      referencia: t.resumo.referencia, faltaDepois: t.resumo.faltaDepois, proxima: t.resumo.proxima, restantes: t.resumo.restantes, ficaDevendo: t.resumo.ficaDevendo,
    }
    return { ...base, mensagem: mensagemRecibo(base) }
  }
  const ehUltima = (t: Transacao) => {
    const ultima = transacoes.filter((x) => x.vendaId === t.vendaId && x.tipo === 'PARCELA' && !x.desfeita).sort((a, b) => b.id - a.id)[0]
    return ultima?.id === t.id
  }
  const podeDesfazer = (s: Sessao, t: Transacao) => t.tipo === 'PARCELA' && !t.desfeita && ehUltima(t) && (s.perfil === 'ADMIN' || (t.recebidoPorId === s.usuarioId && t.data === hoje))

  return {
    async registrar(s, vendaId, e) {
      permitido(s)
      const r = doEscopo(s, vendaId)
      if (!Number.isInteger(e.parcela) || e.parcela < 1) throw new ErroApi(400, 'Informe qual parcela está sendo paga')
      if (typeof e.valor !== 'number' || !Number.isFinite(e.valor) || e.valor <= 0 || e.valor > 1e8) throw new ErroApi(400, 'Informe quanto foi recebido')
      if (!FORMAS.includes(e.forma)) throw new ErroApi(400, 'Informe a forma de pagamento (PIX, DINHEIRO ou CARTAO)')
      const data = e.data ?? hoje
      if (!dataValida(data)) throw new ErroApi(400, 'data precisa ser uma data válida (AAAA-MM-DD)')
      if (data > hoje) throw new ErroApi(400, 'A data do recebimento não pode ser no futuro')
      if (e.resto !== undefined && e.resto !== 'FICA' && e.resto !== 'DESCONTO') throw new ErroApi(400, 'resto deve ser FICA ou DESCONTO')
      if (s.perfil === 'COBRADOR' && data !== hoje) throw new ErroApi(403, 'O cobrador só lança o que recebeu hoje', 'SEM_PERMISSAO')
      if (s.perfil === 'COBRADOR' && e.resto === 'DESCONTO') throw new ErroApi(403, 'Desconto precisa da aprovação do administrador', 'SEM_PERMISSAO')
      if (r.status === 'RETOMADA' || r.status === 'CANCELADA') throw new ErroApi(409, 'Esta venda foi retomada ou cancelada: não recebe pagamentos', 'VENDA_ENCERRADA')
      if (data < r.dataVenda) throw new ErroApi(400, 'A data do recebimento não pode ser antes da venda')

      let res
      try { res = calcularRecebimento(comoAberta(r), { numero: e.parcela, valor: e.valor, data, hoje, resto: e.resto, novoVenc: e.novoVencimento }) }
      catch (err) { if (err instanceof ErroRecebimento) throw new ErroApi(HTTP[err.codigo], err.message, err.codigo); throw err }

      for (const it of res.itens) {
        const p = r.parcelas.find((x) => x.numero === it.numero)!
        p.pago = arred2(p.pago + it.valorPago)
        p.vencimento = it.depois.vencimento; p.vencimentoOriginal = it.depois.vencimentoOriginal; p.desconto = it.depois.desconto; p.quitadaEm = it.depois.quitadaEm
      }
      const aberta = abertas(r).sort((a, b) => a.numero - b.numero)
      const fica = res.efeitos.find((x) => x.tipo === 'FICA')
      const t: Transacao = {
        id: vendas._interno.proximaTransacao(), numero: vendas._interno.proximoRecibo(), vendaId: r.id, clienteId: r.cliente.id, tipo: 'PARCELA', valor: res.valorTotal, forma: e.forma, data,
        recebidoPorId: s.usuarioId ?? null, recebidoPorNome: s.perfil === 'ADMIN' ? 'Geovane' : 'Diego Ramos', desfeita: false,
        itens: res.itens.map((i) => ({ numero: i.numero, valorPago: i.valorPago, antes: i.antes })),
        resumo: {
          referencia: referencia(res.itens.map((i) => i.numero), r.parcelas.length), faltaDepois: arred2(r.parcelas.reduce((x, p) => x + Math.max(0, falta(p)), 0)),
          proxima: aberta[0] ? { numero: aberta[0].numero, valor: falta(aberta[0]), vencimento: aberta[0].vencimento } : null, restantes: aberta.length,
          ficaDevendo: fica && fica.tipo === 'FICA' ? { numero: fica.numero, valor: fica.resta, vencimento: fica.vencimento } : null,
        },
      }
      transacoes.push(t)
      r.status = aberta.length === 0 ? 'QUITADA' : 'ATIVA'
      return { recibo: recibo(t), efeitos: res.efeitos, vendaQuitada: aberta.length === 0 }
    },

    async recibo(s, id) {
      permitido(s)
      const t = transacoes.find((x) => x.id === id)
      if (!t) throw new ErroApi(404, 'Recibo não encontrado', 'NAO_ENCONTRADO')
      doEscopo(s, t.vendaId) // fora do escopo é como se não existisse
      return recibo(t)
    },

    async pagamentos(s, vendaId) {
      permitido(s)
      doEscopo(s, vendaId)
      return transacoes.filter((t) => t.vendaId === vendaId).sort((a, b) => b.id - a.id).map<PagamentoApi>((t) => ({
        transacaoId: t.id, numero: String(t.numero).padStart(6, '0'), data: t.data, forma: t.forma, valor: t.valor, recebidoPor: primeiroNome(t.recebidoPorNome),
        referencia: t.resumo.referencia, tipo: t.tipo, desfeita: t.desfeita, podeDesfazer: podeDesfazer(s, t),
      }))
    },

    async desfazer(s, transacaoId) {
      permitido(s)
      const t = transacoes.find((x) => x.id === transacaoId)
      if (!t) throw new ErroApi(404, 'Recebimento não encontrado', 'NAO_ENCONTRADO')
      if (t.tipo === 'ENTRADA') throw new ErroApi(409, 'A entrada da venda não se desfaz aqui', 'ENTRADA_NAO_DESFAZ')
      const r = doEscopo(s, t.vendaId)
      if (t.desfeita) throw new ErroApi(409, 'Este recebimento já foi desfeito', 'JA_DESFEITO')
      if (s.perfil === 'COBRADOR' && (t.recebidoPorId !== s.usuarioId || t.data !== hoje)) throw new ErroApi(403, 'O cobrador só desfaz o que ele mesmo recebeu hoje', 'SEM_PERMISSAO')
      if (!ehUltima(t)) throw new ErroApi(409, 'Só o último recebimento da venda pode ser desfeito', 'NAO_E_O_ULTIMO')
      for (const it of t.itens) {
        const p = r.parcelas.find((x) => x.numero === it.numero)!
        p.pago = arred2(p.pago - it.valorPago)
        p.vencimento = it.antes.vencimento || p.vencimento; p.vencimentoOriginal = it.antes.vencimentoOriginal; p.desconto = it.antes.desconto; p.quitadaEm = it.antes.quitadaEm
      }
      t.desfeita = true
      r.status = abertas(r).length === 0 ? 'QUITADA' : 'ATIVA'
    },

    async cobrancas(s, q) {
      permitido(s)
      const aba = q.aba ?? 'atrasadas'
      if (!ABAS.includes(aba)) throw new ErroApi(400, 'aba inválida')
      const limite = Math.min(Math.max(q.limite ?? 20, 1), 100)
      const pagina = Math.max(q.pagina ?? 1, 1)
      const ultimaDe = (r: Registro, numero: number) => transacoes.filter((t) => t.vendaId === r.id && t.tipo === 'PARCELA' && !t.desfeita && t.itens.some((i) => i.numero === numero)).sort((a, b) => b.id - a.id)[0]
      const todas: CobrancaApi[] = vendas._interno.noEscopo(s).filter((r) => r.status !== 'RETOMADA' && r.status !== 'CANCELADA').flatMap((r) =>
        r.parcelas.map((p) => {
          const u = ultimaDe(r, p.numero)
          const f = falta(p)
          return {
            vendaId: r.id, parcela: p.numero, nParcelas: r.parcelas.length, vencimento: p.vencimento, vencimentoOriginal: p.vencimentoOriginal, valor: p.valor, pago: p.pago, falta: f,
            atrasoDias: f > 0.009 && p.vencimento < hoje ? Math.round((Date.parse(hoje) - Date.parse(p.vencimento)) / 864e5) : 0,
            cliente: { id: r.cliente.id, nome: r.cliente.nome, fone: foneDe(r.cliente.id) }, aparelho: r.aparelho.modelo, ultimaTransacaoId: u?.id ?? null, ultimoRecebimentoEm: u?.data ?? null,
          }
        }),
      )
      const aberta = (c: CobrancaApi) => c.falta > 0.009
      const daAba: Record<AbaCobranca, (c: CobrancaApi) => boolean> = {
        atrasadas: (c) => aberta(c) && c.vencimento < hoje,
        hoje: (c) => aberta(c) && c.vencimento >= hoje && c.vencimento <= addDia(hoje, 7),
        proximas: (c) => aberta(c) && c.vencimento >= addDia(hoje, 8) && c.vencimento <= addDia(hoje, 45),
        recebidas: (c) => c.ultimoRecebimentoEm !== null && c.ultimoRecebimentoEm >= addDia(hoje, -30),
      }
      const filtradas = todas.filter(daAba[aba]).sort((a, b) => (aba === 'recebidas' ? (b.ultimoRecebimentoEm ?? '').localeCompare(a.ultimoRecebimentoEm ?? '') : a.vencimento.localeCompare(b.vencimento)))
      return {
        itens: filtradas.slice((pagina - 1) * limite, pagina * limite), total: filtradas.length,
        valorTotal: arred2(filtradas.reduce((x, c) => x + (aba === 'recebidas' ? c.pago : c.falta), 0)), pagina, limite,
        contagens: { atrasadas: todas.filter(daAba.atrasadas).length, hoje: todas.filter(daAba.hoje).length, proximas: todas.filter(daAba.proximas).length },
      }
    },
  }
}
