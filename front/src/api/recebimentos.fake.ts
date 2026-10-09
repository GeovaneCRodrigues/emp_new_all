import { criarSeed } from '@/data/seed'
import { addDia } from '@/domain/datas'
import { soDigitos } from '@/domain/documentos'
import type { Sessao } from '@/domain/escopo'
import { nomeEmprestimo } from '@/domain/emprestimo'
import { arred2 } from '@/domain/format'
import { calcularRecebimento, calcularRecebimentoJuros, ErroRecebimento, falta, referencia, type AjusteParcela, type EfeitoRecebimento, type ParcelaAberta } from '@/domain/recebimento'
import { ErroApi } from './clientes'
import type { EmprestimosFake, RegistroEmprestimo } from './emprestimos.fake'
import type { AbaCobranca, AlvoApi, CobrancaApi, PagamentoApi, ReciboApi, RecebimentosApi } from './recebimentos'
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
  const amort = r.amortizacao ? `\nO que passou do juro (${brl(r.amortizacao.valor)}) abateu o capital. Capital em aberto: ${brl(r.amortizacao.capitalRestante)}.` : ''
  const resto = r.ficaDevendo ? `\nNa ${r.ficaDevendo.numero}ª ainda ficam ${brl(r.ficaDevendo.valor)}, para ${dmy(r.ficaDevendo.vencimento)}.` : ''
  return `*${empresa}* · Recibo nº ${r.numero}\n\nOi ${primeiroNome(r.cliente.nome)}! Recebemos ${brl(r.valor)} em ${dmyA(r.data)} (${NOME_FORMA[r.forma]}), referente à ${r.referencia} do ${r.operacao === 'EMPRESTIMO' ? r.aparelho.toLowerCase() : 'seu ' + r.aparelho}.${resto}${amort}\n\n${prox}\n\nObrigado!`
}

/** A venda ou o empréstimo, visto de um jeito só. */
interface Op {
  alvo: AlvoApi
  id: number
  cliente: { id: number; nome: string }
  data: string
  status: string
  descricao: string
  parcelas: Registro['parcelas']
  /** só empréstimo */
  emp: RegistroEmprestimo | null
}

/**
 * Versão de demonstração: mesmas regras do backend (quem pode, data, desconto só do admin, desfazer só o último,
 * cobranças por aba e tipo, só juros que amortiza o capital), sobre as mesmas vendas e empréstimos da demonstração.
 */
export function criarRecebimentosFake(vendas: VendasFake, emprestimos?: EmprestimosFake): RecebimentosApi {
  const { hoje, registros, transacoes } = vendas._interno
  const fones = new Map(criarSeed().clientes.map((c) => [c.id, soDigitos(c.fone)]))
  const foneDe = (id: number) => fones.get(id) ?? ''

  const permitido = (s: Sessao) => { if (s.perfil !== 'ADMIN' && s.perfil !== 'COBRADOR') throw new ErroApi(403, 'Só o administrador e o cobrador mexem com recebimentos', 'SEM_PERMISSAO') }
  const comoOp = (r: Registro): Op => ({ alvo: 'VENDA', id: r.id, cliente: r.cliente, data: r.dataVenda, status: r.status, descricao: r.aparelho.modelo, parcelas: r.parcelas, emp: null })
  const comoOpEmp = (r: RegistroEmprestimo): Op => ({ alvo: 'EMPRESTIMO', id: r.id, cliente: r.cliente, data: r.dataEmprestimo, status: r.status, descricao: nomeEmprestimo(r.modalidade, r.periodicidade), parcelas: r.parcelas, emp: r })
  const doEscopo = (s: Sessao, alvo: AlvoApi, id: number): Op => {
    if (alvo === 'VENDA') {
      const r = vendas._interno.noEscopo(s).find((x) => x.id === id)
      if (!r) throw new ErroApi(404, 'Venda não encontrada', 'NAO_ENCONTRADO')
      return comoOp(r)
    }
    const r = emprestimos?._interno.noEscopo(s).find((x) => x.id === id)
    if (!r) throw new ErroApi(404, 'Empréstimo não encontrado', 'NAO_ENCONTRADO')
    return comoOpEmp(r)
  }
  const abertas = (o: Op) => o.parcelas.filter((p) => falta(p) > 0.009)
  const comoAberta = (o: Op): ParcelaAberta[] => o.parcelas.map((p) => ({ id: p.numero, numero: p.numero, vencimento: p.vencimento, vencimentoOriginal: p.vencimentoOriginal, valor: p.valor, desconto: p.desconto, pago: p.pago, quitadaEm: p.quitadaEm }))
  const opDe = (t: Transacao): Op => {
    if (t.alvo === 'VENDA') return comoOp(registros.find((r) => r.id === t.operacaoId)!)
    return comoOpEmp(emprestimos!._interno.registros.find((r) => r.id === t.operacaoId)!)
  }
  const definirStatus = (o: Op, status: 'ATIVA' | 'QUITADA') => {
    if (o.alvo === 'VENDA') registros.find((r) => r.id === o.id)!.status = status
    else emprestimos!._interno.registros.find((r) => r.id === o.id)!.status = status
  }

  function recibo(t: Transacao): ReciboApi {
    const o = opDe(t)
    const base = {
      id: t.id, numero: String(t.numero).padStart(6, '0'), empresa: { nome: 'Mundo dos iPhones', cnpj: null }, cliente: { id: o.cliente.id, nome: o.cliente.nome, fone: foneDe(o.cliente.id) },
      operacao: t.alvo, aparelho: o.descricao, valor: t.valor, forma: t.forma, data: t.data, recebidoPor: primeiroNome(t.recebidoPorNome), desfeita: t.desfeita,
      referencia: t.resumo.referencia, faltaDepois: t.resumo.faltaDepois, proxima: t.resumo.proxima, restantes: t.resumo.restantes, ficaDevendo: t.resumo.ficaDevendo, amortizacao: t.resumo.amortizacao ?? null,
    }
    return { ...base, mensagem: mensagemRecibo(base) }
  }
  const ehUltima = (t: Transacao) => {
    const ultima = transacoes.filter((x) => x.alvo === t.alvo && x.operacaoId === t.operacaoId && x.tipo === 'PARCELA' && !x.desfeita).sort((a, b) => b.id - a.id)[0]
    return ultima?.id === t.id
  }
  const podeDesfazer = (s: Sessao, t: Transacao) => t.tipo === 'PARCELA' && !t.desfeita && ehUltima(t) && (s.perfil === 'ADMIN' || (t.recebidoPorId === s.usuarioId && t.data === hoje))
  const capitalAberto = (r: RegistroEmprestimo) => arred2(r.capital - r.amortizado)

  return {
    async registrar(s, alvo, operacaoId, e) {
      permitido(s)
      const o = doEscopo(s, alvo, operacaoId)
      if (!Number.isInteger(e.parcela) || e.parcela < 1) throw new ErroApi(400, 'Informe qual parcela está sendo paga')
      if (typeof e.valor !== 'number' || !Number.isFinite(e.valor) || e.valor <= 0 || e.valor > 1e8) throw new ErroApi(400, 'Informe quanto foi recebido')
      if (!FORMAS.includes(e.forma)) throw new ErroApi(400, 'Informe a forma de pagamento (PIX, DINHEIRO ou CARTAO)')
      const data = e.data ?? hoje
      if (!dataValida(data)) throw new ErroApi(400, 'data precisa ser uma data válida (AAAA-MM-DD)')
      if (data > hoje) throw new ErroApi(400, 'A data do recebimento não pode ser no futuro')
      if (e.resto !== undefined && e.resto !== 'FICA' && e.resto !== 'DESCONTO') throw new ErroApi(400, 'resto deve ser FICA ou DESCONTO')
      if (s.perfil === 'COBRADOR' && data !== hoje) throw new ErroApi(403, 'O cobrador só lança o que recebeu hoje', 'SEM_PERMISSAO')
      if (s.perfil === 'COBRADOR' && e.resto === 'DESCONTO') throw new ErroApi(403, 'Desconto precisa da aprovação do administrador: use "pedir desconto"', 'SEM_PERMISSAO')
      let motivoPedido: string | null = null
      if (e.pedirDesconto !== undefined && e.pedirDesconto !== null) {
        if (s.perfil !== 'COBRADOR') throw new ErroApi(403, 'Só o cobrador pede desconto (o administrador dá o desconto direto)', 'SEM_PERMISSAO')
        const m = typeof e.pedirDesconto.motivo === 'string' ? e.pedirDesconto.motivo.trim() : ''
        if (m.length < 3 || m.length > 500) throw new ErroApi(400, 'Explique o motivo do pedido de desconto (de 3 a 500 letras)')
        if (e.resto !== 'FICA') throw new ErroApi(400, 'Para pedir desconto, o resto precisa ficar devendo até o administrador responder')
        motivoPedido = m
      }
      if (s.perfil === 'COBRADOR' && vendas._interno.fechamentos.some((f) => f.usuarioId === s.usuarioId && f.data === data)) throw new ErroApi(409, 'O seu dia já foi fechado. Peça ao administrador para reabrir.', 'DIA_FECHADO')
      if (o.status === 'RETOMADA' || o.status === 'CANCELADA') throw new ErroApi(409, alvo === 'VENDA' ? 'Esta venda foi retomada ou cancelada: não recebe pagamentos' : 'Este empréstimo foi cancelado: não recebe pagamentos', 'VENDA_ENCERRADA')
      if (data < o.data) throw new ErroApi(400, alvo === 'VENDA' ? 'A data do recebimento não pode ser antes da venda' : 'A data do recebimento não pode ser antes do empréstimo')

      const pedidoCalc = { numero: e.parcela, valor: e.valor, data, hoje, resto: e.resto, novoVenc: e.novoVencimento }
      let res
      let ajustes: AjusteParcela[] = []
      let amortizacao = 0
      let capitalRestante = 0
      try {
        if (o.emp && o.emp.modalidade === 'JUROS') {
          const j = calcularRecebimentoJuros(comoAberta(o), pedidoCalc, { capitalAberto: capitalAberto(o.emp), taxa: o.emp.taxa })
          res = j; ajustes = j.ajustes; amortizacao = j.amortizacao; capitalRestante = j.capitalRestante
        } else res = calcularRecebimento(comoAberta(o), pedidoCalc)
      } catch (err) { if (err instanceof ErroRecebimento) throw new ErroApi(HTTP[err.codigo], err.message, err.codigo); throw err }

      let pedidoId: number | null = null
      if (motivoPedido) {
        const resta = res.itens[0].faltaDepois
        if (resta <= 0.009) throw new ErroApi(400, 'Não sobrou nada na parcela para pedir desconto')
        if (vendas._interno.pedidos.some((x) => x.tipo === 'DESCONTO' && x.alvo === alvo && x.operacaoId === o.id && x.parcela === e.parcela && x.status === 'PENDENTE')) throw new ErroApi(409, 'Já existe um pedido de desconto esperando para esta parcela', 'PEDIDO_JA_EXISTE')
        pedidoId = vendas._interno.proximoPedido()
        vendas._interno.pedidos.push({ id: pedidoId, tipo: 'DESCONTO', alvo, operacaoId: o.id, parcela: e.parcela, valor: resta, motivo: motivoPedido, solicitanteId: s.usuarioId ?? 0, solicitanteNome: 'Diego Ramos', status: 'PENDENTE', criadaEm: `${hoje}T12:00:00.000Z`, respondidoPor: null, respondidoEm: null, resposta: null })
      }
      for (const it of res.itens) {
        const p = o.parcelas.find((x) => x.numero === it.numero)!
        p.pago = arred2(p.pago + it.valorPago)
        p.vencimento = it.depois.vencimento; p.vencimentoOriginal = it.depois.vencimentoOriginal; p.desconto = it.depois.desconto; p.quitadaEm = it.depois.quitadaEm
      }
      // só juros: o juro seguinte, recalculado sobre o capital que sobrou
      for (const a of ajustes) {
        const p = o.parcelas.find((x) => x.numero === a.numero)!
        p.valor = a.depois.valor ?? p.valor; p.quitadaEm = a.depois.quitadaEm
      }
      if (o.emp && amortizacao > 0) o.emp.amortizado = arred2(o.emp.amortizado + amortizacao)
      const aberta = abertas(o).sort((a, b) => a.numero - b.numero)
      const fica = res.efeitos.find((x): x is Extract<EfeitoRecebimento, { tipo: 'FICA' }> => x.tipo === 'FICA')
      const t: Transacao = {
        id: vendas._interno.proximaTransacao(), numero: vendas._interno.proximoRecibo(), alvo, operacaoId: o.id, clienteId: o.cliente.id, clienteNome: o.cliente.nome, tipo: 'PARCELA', valor: res.valorTotal, forma: e.forma, data,
        recebidoPorId: s.usuarioId ?? null, recebidoPorNome: s.perfil === 'ADMIN' ? 'Geovane' : 'Diego Ramos', desfeita: false,
        itens: res.itens.map((i) => ({ numero: i.numero, valorPago: i.valorPago, antes: i.antes })),
        ...(ajustes.length || amortizacao > 0 ? { ajustes: { amortizacao, parcelas: ajustes.map((a) => ({ numero: a.numero, antes: a.antes })) } } : {}),
        resumo: {
          referencia: referencia(res.itens.map((i) => i.numero), o.parcelas.length), faltaDepois: arred2(o.parcelas.reduce((x, p) => x + Math.max(0, falta(p)), 0)),
          proxima: aberta[0] ? { numero: aberta[0].numero, valor: falta(aberta[0]), vencimento: aberta[0].vencimento } : null, restantes: aberta.length,
          ficaDevendo: fica ? { numero: fica.numero, valor: fica.resta, vencimento: fica.vencimento } : null,
          ...(amortizacao > 0 ? { amortizacao: { valor: amortizacao, capitalRestante } } : {}),
        },
      }
      transacoes.push(t)
      definirStatus(o, aberta.length === 0 ? 'QUITADA' : 'ATIVA')
      return { recibo: recibo(t), efeitos: res.efeitos, quitada: aberta.length === 0, pedidoDescontoId: pedidoId }
    },

    async recibo(s, id) {
      permitido(s)
      const t = transacoes.find((x) => x.id === id)
      if (!t) throw new ErroApi(404, 'Recibo não encontrado', 'NAO_ENCONTRADO')
      doEscopo(s, t.alvo, t.operacaoId) // fora do escopo é como se não existisse
      return recibo(t)
    },

    async pagamentos(s, alvo, operacaoId) {
      permitido(s)
      doEscopo(s, alvo, operacaoId)
      return transacoes.filter((t) => t.alvo === alvo && t.operacaoId === operacaoId).sort((a, b) => b.id - a.id).map<PagamentoApi>((t) => ({
        transacaoId: t.id, numero: String(t.numero).padStart(6, '0'), data: t.data, forma: t.forma, valor: t.valor, recebidoPor: primeiroNome(t.recebidoPorNome),
        referencia: t.resumo.referencia, tipo: t.tipo, desfeita: t.desfeita, podeDesfazer: podeDesfazer(s, t),
      }))
    },

    async desfazer(s, transacaoId) {
      permitido(s)
      const t = transacoes.find((x) => x.id === transacaoId)
      if (!t) throw new ErroApi(404, 'Recebimento não encontrado', 'NAO_ENCONTRADO')
      if (t.tipo === 'ENTRADA') throw new ErroApi(409, 'A entrada da venda não se desfaz aqui', 'ENTRADA_NAO_DESFAZ')
      const o = doEscopo(s, t.alvo, t.operacaoId)
      if (t.desfeita) throw new ErroApi(409, 'Este recebimento já foi desfeito', 'JA_DESFEITO')
      if (s.perfil === 'COBRADOR' && (t.recebidoPorId !== s.usuarioId || t.data !== hoje)) throw new ErroApi(403, 'O cobrador só desfaz o que ele mesmo recebeu hoje', 'SEM_PERMISSAO')
      if (!ehUltima(t)) throw new ErroApi(409, t.alvo === 'VENDA' ? 'Só o último recebimento da venda pode ser desfeito' : 'Só o último recebimento do empréstimo pode ser desfeito', 'NAO_E_O_ULTIMO')
      if (t.recebidoPorId !== null && vendas._interno.fechamentos.some((f) => f.usuarioId === t.recebidoPorId && f.data === t.data)) throw new ErroApi(409, 'O dia desse recebimento já foi fechado. Reabra o fechamento antes de desfazer.', 'DIA_FECHADO')
      for (const it of t.itens) {
        const p = o.parcelas.find((x) => x.numero === it.numero)!
        p.pago = arred2(p.pago - it.valorPago)
        p.vencimento = it.antes.vencimento || p.vencimento; p.vencimentoOriginal = it.antes.vencimentoOriginal; p.desconto = it.antes.desconto; p.quitadaEm = it.antes.quitadaEm
      }
      // só juros: as parcelas recalculadas voltam ao valor de antes e o capital amortizado volta
      for (const a of t.ajustes?.parcelas ?? []) {
        const p = o.parcelas.find((x) => x.numero === a.numero)!
        p.valor = a.antes.valor ?? p.valor; p.quitadaEm = a.antes.quitadaEm
      }
      if (o.emp && t.ajustes) o.emp.amortizado = arred2(o.emp.amortizado - t.ajustes.amortizacao)
      t.desfeita = true
      definirStatus(o, abertas(o).length === 0 ? 'QUITADA' : 'ATIVA')
    },

    async cobrancas(s, q) {
      permitido(s)
      const aba = q.aba ?? 'atrasadas'
      if (!ABAS.includes(aba)) throw new ErroApi(400, 'aba inválida')
      if (q.tipo !== undefined && q.tipo !== 'VENDA' && q.tipo !== 'EMPRESTIMO') throw new ErroApi(400, 'tipo deve ser VENDA ou EMPRESTIMO')
      const limite = Math.min(Math.max(q.limite ?? 20, 1), 100)
      const pagina = Math.max(q.pagina ?? 1, 1)
      const ops: Op[] = [
        ...(q.tipo === 'EMPRESTIMO' ? [] : vendas._interno.noEscopo(s).filter((r) => r.status !== 'RETOMADA' && r.status !== 'CANCELADA').map(comoOp)),
        ...(q.tipo === 'VENDA' || !emprestimos ? [] : emprestimos._interno.noEscopo(s).filter((r) => r.status !== 'CANCELADA').map(comoOpEmp)),
      ]
      const ultimaDe = (o: Op, numero: number) => transacoes.filter((t) => t.alvo === o.alvo && t.operacaoId === o.id && t.tipo === 'PARCELA' && !t.desfeita && t.itens.some((i) => i.numero === numero)).sort((a, b) => b.id - a.id)[0]
      const todas: CobrancaApi[] = ops.flatMap((o) =>
        o.parcelas.map((p) => {
          const u = ultimaDe(o, p.numero)
          const f = falta(p)
          return {
            tipo: o.alvo, operacaoId: o.id, parcela: p.numero, nParcelas: o.parcelas.length, vencimento: p.vencimento, vencimentoOriginal: p.vencimentoOriginal, valor: p.valor, pago: p.pago, falta: f,
            atrasoDias: f > 0.009 && p.vencimento < hoje ? Math.round((Date.parse(hoje) - Date.parse(p.vencimento)) / 864e5) : 0,
            cliente: { id: o.cliente.id, nome: o.cliente.nome, fone: foneDe(o.cliente.id) }, aparelho: o.descricao, ultimaTransacaoId: u?.id ?? null, ultimoRecebimentoEm: u?.data ?? null,
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
