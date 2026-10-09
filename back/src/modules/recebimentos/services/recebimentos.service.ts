import { HttpError, naoEncontrado, requisicaoInvalida, semPermissao } from '../../../shared/errors.js'
import type { Sessao } from '../../../shared/perfis.js'
import { hojeBR } from '../../../shared/relogio.js'
import type { AuditoriaRepository } from '../../auditoria/models/repository.js'
import { arred2 } from '../../vendas/services/calculo.js'
import type { RecebimentosRepository } from '../models/repository.js'
import type { Aba, Alvo, EscopoRecebimentos, FormaPagamento, LinhaCobranca, ParcelaAberta, ResumoRecibo, ReciboRegistro } from '../models/types.js'
import { calcularRecebimento, calcularRecebimentoJuros, ErroRecebimento, falta, referencia, type AjusteParcela, type EfeitoRecebimento } from './calculo.js'

export type Entrada = Record<string, unknown>

export type Recibo = {
  id: number
  numero: string
  empresa: { nome: string; cnpj: string | null }
  cliente: { id: number; nome: string; fone: string }
  /** a venda ou o empréstimo que foi pago */
  operacao: Alvo
  /** "iPhone 15 Pro" ou "Empréstimo só juros" */
  aparelho: string
  valor: number
  forma: FormaPagamento
  data: string
  recebidoPor: string
  desfeita: boolean
  referencia: string
  faltaDepois: number
  proxima: ResumoRecibo['proxima']
  restantes: number
  ficaDevendo: ResumoRecibo['ficaDevendo']
  amortizacao: ResumoRecibo['amortizacao'] | null
  /** texto pronto para o WhatsApp do cliente */
  mensagem: string
}

export type Registrado = { recibo: Recibo; efeitos: EfeitoRecebimento[]; quitada: boolean; pedidoDescontoId: number | null }
export type PagamentoView = { transacaoId: number; numero: string; data: string; forma: FormaPagamento; valor: number; recebidoPor: string; referencia: string; tipo: 'ENTRADA' | 'PARCELA'; desfeita: boolean; podeDesfazer: boolean }
export type ListaCobrancas = { itens: (LinhaCobranca & { atrasoDias: number })[]; total: number; valorTotal: number; pagina: number; limite: number; contagens: { atrasadas: number; hoje: number; proximas: number } }

export type RecebimentosService = {
  registrar(s: Sessao, alvo: Alvo, operacaoId: number, e: Entrada): Promise<Registrado>
  recibo(s: Sessao, transacaoId: number): Promise<Recibo>
  pagamentos(s: Sessao, alvo: Alvo, operacaoId: number): Promise<PagamentoView[]>
  desfazer(s: Sessao, transacaoId: number): Promise<void>
  cobrancas(s: Sessao, q: { aba?: string; tipo?: string; busca?: string; pagina?: number; limite?: number }): Promise<ListaCobrancas>
}

const FORMAS: FormaPagamento[] = ['PIX', 'DINHEIRO', 'CARTAO']
const NOME_FORMA: Record<FormaPagamento, string> = { PIX: 'Pix', DINHEIRO: 'Dinheiro', CARTAO: 'Cartão' }
const ABAS: Aba[] = ['atrasadas', 'hoje', 'proximas', 'recebidas']
const LIMITE_MAX = 100
const DINHEIRO_MAX = 100_000_000
const DATA = /^\d{4}-\d{2}-\d{2}$/

const dataValida = (v: unknown): v is string => typeof v === 'string' && DATA.test(v) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const dmyA = (iso: string) => `${dmy(iso)}/${iso.slice(0, 4)}`
const brl = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const primeiroNome = (n: string | null) => (n ?? '').trim().split(/\s+/)[0] || '—'

const CODIGO_HTTP: Record<ErroRecebimento['codigo'], number> = { PARCELA_INEXISTENTE: 404, PARCELA_PAGA: 409, VALOR_INVALIDO: 400, EXCEDE_DIVIDA: 400, RESTO_OBRIGATORIO: 400, VENCIMENTO_INVALIDO: 400 }

function escopoDe(s: Sessao): EscopoRecebimentos {
  if (s.perfil === 'ADMIN') return { tipo: 'TODOS' }
  if (s.perfil === 'COBRADOR') return { tipo: 'CARTEIRA', usuarioId: s.usuarioId }
  throw semPermissao('Só o administrador e o cobrador mexem com recebimentos')
}

/** Quem pode VER a lista de cobranças: além de quem recebe, o indicador vê as parcelas das operações dele (só leitura). */
function escopoLeitura(s: Sessao): EscopoRecebimentos {
  if (s.perfil === 'INDICADOR') return { tipo: 'INDICADOR', indicadorId: s.indicadorId ?? -1 }
  return escopoDe(s)
}

/** O texto que vai para o WhatsApp do cliente. */
export function mensagemRecibo(r: Omit<Recibo, 'mensagem'>): string {
  const empresa = r.empresa.nome.replace(/\s+LTDA\.?$/i, '')
  const prox = r.proxima
    ? `Próxima: ${r.proxima.numero}ª, ${brl(r.proxima.valor)}, vence ${dmy(r.proxima.vencimento)}. ${r.restantes === 1 ? 'Falta 1 parcela' : `Faltam ${r.restantes} parcelas`} (${brl(r.faltaDepois)}).`
    : 'Tudo quitado! Obrigado pela confiança.'
  const amort = r.amortizacao ? `\nO que passou do juro (${brl(r.amortizacao.valor)}) abateu o capital. Capital em aberto: ${brl(r.amortizacao.capitalRestante)}.` : ''
  const resto = r.ficaDevendo ? `\nNa ${r.ficaDevendo.numero}ª ainda ficam ${brl(r.ficaDevendo.valor)}, para ${dmy(r.ficaDevendo.vencimento)}.` : ''
  return `*${empresa}* · Recibo nº ${r.numero}\n\nOi ${primeiroNome(r.cliente.nome)}! Recebemos ${brl(r.valor)} em ${dmyA(r.data)} (${NOME_FORMA[r.forma]}), referente à ${r.referencia} do ${r.operacao === 'EMPRESTIMO' ? r.aparelho.toLowerCase() : 'seu ' + r.aparelho}.${resto}${amort}\n\n${prox}\n\nObrigado!`
}

export type Dependencias = {
  repo: RecebimentosRepository
  auditoria: AuditoriaRepository
  hoje?: () => string
  /** Só para teste: segura a transação logo depois de ler as parcelas, para forçar duas transações a se sobreporem. */
  depoisDeLerParcelas?: () => Promise<void>
}

export function createRecebimentosService(dep: Dependencias): RecebimentosService {
  const hoje = dep.hoje ?? (() => hojeBR())

  async function montarRecibo(r: ReciboRegistro): Promise<Recibo> {
    const empresa = await dep.repo.empresa()
    const res = r.resumo ?? { tipo: r.tipo === 'ENTRADA' ? ('ENTRADA' as const) : ('PARCELAS' as const), referencia: r.tipo === 'ENTRADA' ? 'entrada' : 'pagamento', faltaDepois: 0, proxima: null, restantes: 0, ficaDevendo: null }
    const base = {
      id: r.id, numero: String(r.numeroRecibo).padStart(6, '0'), empresa, cliente: { id: r.clienteId, nome: r.clienteNome, fone: r.clienteFone }, operacao: r.alvo ?? ('VENDA' as Alvo), aparelho: r.descricao,
      valor: r.valorTotal, forma: r.forma, data: r.data, recebidoPor: primeiroNome(r.recebidoPorNome), desfeita: r.desfeita, referencia: res.referencia,
      faltaDepois: res.faltaDepois, proxima: res.proxima, restantes: res.restantes, ficaDevendo: res.ficaDevendo, amortizacao: res.amortizacao ?? null,
    }
    return { ...base, mensagem: mensagemRecibo(base) }
  }

  async function reciboDe(s: Sessao, transacaoId: number): Promise<Recibo> {
    const escopo = escopoDe(s)
    const r = await dep.repo.buscarRecibo(transacaoId)
    if (!r || (escopo.tipo === 'CARTEIRA' && r.responsavelId !== escopo.usuarioId)) throw naoEncontrado('Recibo não encontrado')
    return montarRecibo(r)
  }

  return {
    async registrar(s, alvo, operacaoId, e) {
      const escopo = escopoDe(s)
      const numero = e.parcela
      if (typeof numero !== 'number' || !Number.isInteger(numero) || numero < 1) throw requisicaoInvalida('Informe qual parcela está sendo paga')
      if (typeof e.valor !== 'number' || !Number.isFinite(e.valor) || e.valor <= 0 || e.valor > DINHEIRO_MAX) throw requisicaoInvalida('Informe quanto foi recebido')
      if (!FORMAS.includes(e.forma as FormaPagamento)) throw requisicaoInvalida('Informe a forma de pagamento (PIX, DINHEIRO ou CARTAO)')
      const forma = e.forma as FormaPagamento
      const dia = hoje()
      const data = e.data === undefined || e.data === null ? dia : e.data
      if (!dataValida(data)) throw requisicaoInvalida('data precisa ser uma data válida (AAAA-MM-DD)')
      if (data > dia) throw requisicaoInvalida('A data do recebimento não pode ser no futuro')
      if (e.resto !== undefined && e.resto !== 'FICA' && e.resto !== 'DESCONTO') throw requisicaoInvalida('resto deve ser FICA ou DESCONTO')
      if (e.novoVencimento !== undefined && e.novoVencimento !== null && !dataValida(e.novoVencimento)) throw requisicaoInvalida('novoVencimento precisa ser uma data válida (AAAA-MM-DD)')
      // cobrador: só lança o que recebeu hoje, e desconto só com a aprovação do administrador
      if (s.perfil === 'COBRADOR' && data !== dia) throw semPermissao('O cobrador só lança o que recebeu hoje')
      if (s.perfil === 'COBRADOR' && e.resto === 'DESCONTO') throw semPermissao('Desconto precisa da aprovação do administrador: use "pedir desconto"')
      // o cobrador pode pedir desconto do que faltou: o pagamento é lançado e a parcela fica aberta até o admin responder
      let pedir: { motivo: string } | null = null
      if (e.pedirDesconto !== undefined && e.pedirDesconto !== null) {
        if (s.perfil !== 'COBRADOR') throw semPermissao('Só o cobrador pede desconto (o administrador dá o desconto direto)')
        const motivo = typeof (e.pedirDesconto as { motivo?: unknown })?.motivo === 'string' ? (e.pedirDesconto as { motivo: string }).motivo.trim() : ''
        if (motivo.length < 3 || motivo.length > 500) throw requisicaoInvalida('Explique o motivo do pedido de desconto (de 3 a 500 letras)')
        if (e.resto !== 'FICA') throw requisicaoInvalida('Para pedir desconto, o resto precisa ficar devendo até o administrador responder')
        pedir = { motivo }
      }

      const feito = await dep.repo.emTransacao(async (tx) => {
        // o caixa do cobrador é serializado: receber e fechar o dia nunca se atropelam
        if (s.perfil === 'COBRADOR') {
          await tx.travarCaixa(s.usuarioId)
          if (await tx.diaFechado(s.usuarioId, data)) throw new HttpError(409, 'O seu dia já foi fechado. Peça ao administrador para reabrir.', 'DIA_FECHADO')
        }
        const venda = await tx.travarOperacao(alvo, operacaoId, escopo)
        if (!venda) throw naoEncontrado(alvo === 'VENDA' ? 'Venda não encontrada' : 'Empréstimo não encontrado')
        if (venda.status === 'RETOMADA' || venda.status === 'CANCELADA') throw new HttpError(409, alvo === 'VENDA' ? 'Esta venda foi retomada ou cancelada: não recebe pagamentos' : 'Este empréstimo foi cancelado: não recebe pagamentos', 'VENDA_ENCERRADA')
        if (data < venda.data) throw requisicaoInvalida(alvo === 'VENDA' ? 'A data do recebimento não pode ser antes da venda' : 'A data do recebimento não pode ser antes do empréstimo')

        const parcelas = await tx.parcelas(alvo, operacaoId)
        await dep.depoisDeLerParcelas?.()
        const pedidoCalc = { numero, valor: e.valor as number, data, hoje: dia, resto: e.resto as 'FICA' | 'DESCONTO' | undefined, novoVenc: (e.novoVencimento as string | undefined) ?? undefined }
        let r
        let ajustes: AjusteParcela[] = []
        let amortizacao = 0
        let capitalRestante = 0
        try {
          // só juros segue a regra própria (excedente abate o capital) enquanto não houve acordo; depois do acordo são parcelas comuns
          if (alvo === 'EMPRESTIMO' && venda.modalidade === 'JUROS' && !venda.temAcordo) {
            // só juros: o que passa do juro da parcela abate o capital e o juro seguinte é recalculado
            const j = calcularRecebimentoJuros(parcelas, pedidoCalc, { capitalAberto: await tx.capitalAberto(operacaoId), taxa: venda.taxa! })
            r = j; ajustes = j.ajustes; amortizacao = j.amortizacao; capitalRestante = j.capitalRestante
          } else r = calcularRecebimento(parcelas, pedidoCalc)
        } catch (err) {
          if (err instanceof ErroRecebimento) throw new HttpError(CODIGO_HTTP[err.codigo], err.message, err.codigo)
          throw err
        }

        // como a operação fica depois: base do recibo e do status
        const depois: ParcelaAberta[] = parcelas.map((p) => {
          const it = r.itens.find((x) => x.parcelaId === p.id)
          if (it) return { ...p, ...it.depois, pago: arred2(p.pago + it.valorPago) }
          const aj = ajustes.find((x) => x.parcelaId === p.id)
          return aj ? { ...p, ...aj.depois, valor: aj.depois.valor ?? p.valor } : p
        })
        const abertas = depois.filter((p) => falta(p) > 0.009).sort((a, b) => a.numero - b.numero)
        const fica = r.efeitos.find((x): x is Extract<EfeitoRecebimento, { tipo: 'FICA' }> => x.tipo === 'FICA')
        const resumo: ResumoRecibo = {
          tipo: 'PARCELAS', referencia: referencia(r.itens.map((i) => i.numero), venda.nParcelas), faltaDepois: arred2(depois.reduce((x, p) => x + Math.max(0, falta(p)), 0)),
          proxima: abertas[0] ? { numero: abertas[0].numero, valor: falta(abertas[0]), vencimento: abertas[0].vencimento } : null, restantes: abertas.length,
          ficaDevendo: fica ? { numero: fica.numero, valor: fica.resta, vencimento: fica.vencimento } : null,
          ...(amortizacao > 0 ? { amortizacao: { valor: amortizacao, capitalRestante } } : {}),
        }
        let pedidoId: number | null = null
        if (pedir) {
          const resta = r.itens[0].faltaDepois
          if (resta <= 0.009) throw requisicaoInvalida('Não sobrou nada na parcela para pedir desconto')
          if (await tx.pedidoPendente(alvo, r.itens[0].parcelaId)) throw new HttpError(409, 'Já existe um pedido de desconto esperando para esta parcela', 'PEDIDO_JA_EXISTE')
          pedidoId = await tx.criarPedidoDesconto(alvo, { operacaoId, parcelaId: r.itens[0].parcelaId, solicitadoPor: s.usuarioId, valor: resta, motivo: pedir.motivo })
        }
        const t = await tx.criarTransacao({
          clienteId: venda.clienteId, valorTotal: r.valorTotal, forma, data, recebidoPor: s.usuarioId, resumo,
          ajustes: ajustes.length || amortizacao > 0 ? { amortizacao, parcelas: ajustes.map((a) => ({ parcelaId: a.parcelaId, numero: a.numero, antes: a.antes })) } : null,
        })
        for (const it of r.itens) {
          await tx.criarRecebimento(alvo, { transacaoId: t.id, parcelaId: it.parcelaId, valor: it.valorPago, antes: it.antes })
          const mudou = it.depois.vencimento !== it.antes.vencimento || it.depois.desconto !== it.antes.desconto || it.depois.quitadaEm !== it.antes.quitadaEm || it.depois.vencimentoOriginal !== it.antes.vencimentoOriginal
          if (mudou) await tx.atualizarParcela(alvo, it.parcelaId, it.depois)
        }
        for (const aj of ajustes) await tx.atualizarParcela(alvo, aj.parcelaId, aj.depois) // só juros: o juro seguinte, recalculado
        const quitada = abertas.length === 0
        await tx.definirStatus(alvo, operacaoId, quitada ? 'QUITADA' : 'ATIVA')
        return { transacaoId: t.id, efeitos: r.efeitos, quitada, primeiro: r.itens[0], pedidoId, motivoPedido: pedir?.motivo ?? null }
      })

      // trilha de auditoria: baixa, desconto e mudança de vencimento
      const base = { usuarioId: s.usuarioId, entidade: alvo === 'VENDA' ? 'venda' : 'emprestimo', entidadeId: operacaoId }
      await dep.auditoria.registrar({ ...base, acao: 'RECEBIMENTO_REGISTRADO', depois: { transacaoId: feito.transacaoId, parcela: numero, valor: e.valor, forma, data, efeitos: feito.efeitos } })
      const desc = feito.efeitos.find((x) => x.tipo === 'DESCONTO')
      if (desc) await dep.auditoria.registrar({ ...base, acao: 'DESCONTO_CONCEDIDO', depois: { transacaoId: feito.transacaoId, ...desc } })
      if (feito.primeiro.depois.vencimento !== feito.primeiro.antes.vencimento) await dep.auditoria.registrar({ ...base, acao: 'VENCIMENTO_ALTERADO', antes: { parcela: numero, vencimento: feito.primeiro.antes.vencimento }, depois: { parcela: numero, vencimento: feito.primeiro.depois.vencimento } })

      if (feito.pedidoId) await dep.auditoria.registrar({ ...base, entidade: 'aprovacao', entidadeId: feito.pedidoId, acao: 'DESCONTO_PEDIDO', depois: { alvo, operacaoId, parcela: numero, motivo: feito.motivoPedido } })

      return { recibo: await reciboDe(s, feito.transacaoId), efeitos: feito.efeitos, quitada: feito.quitada, pedidoDescontoId: feito.pedidoId }
    },

    recibo: reciboDe,

    async pagamentos(s, alvo, operacaoId) {
      const escopo = escopoDe(s)
      if (!(await dep.repo.operacaoNoEscopo(alvo, operacaoId, escopo))) throw naoEncontrado(alvo === 'VENDA' ? 'Venda não encontrada' : 'Empréstimo não encontrado')
      const lista = await dep.repo.pagamentosDaOperacao(alvo, operacaoId) // da mais nova para a mais antiga
      const ultimaId = lista.find((p) => p.tipo === 'PARCELA' && !p.desfeita)?.id
      const dia = hoje()
      return lista.map((p) => ({
        transacaoId: p.id, numero: String(p.numeroRecibo).padStart(6, '0'), data: p.data, forma: p.forma, valor: p.valorTotal, recebidoPor: primeiroNome(p.recebidoPorNome),
        referencia: p.resumo?.referencia ?? (p.tipo === 'ENTRADA' ? 'entrada' : 'pagamento'), tipo: p.tipo, desfeita: p.desfeita,
        podeDesfazer: p.tipo === 'PARCELA' && !p.desfeita && p.id === ultimaId && (s.perfil === 'ADMIN' || (p.recebidoPor === s.usuarioId && p.data === dia)),
      }))
    },

    async desfazer(s, transacaoId) {
      const escopo = escopoDe(s)
      const op = await dep.repo.operacaoDaTransacao(transacaoId)
      if (op === null) {
        // ou não existe, ou é a entrada de uma venda (que só some cancelando a venda)
        if (await dep.repo.buscarRecibo(transacaoId)) throw new HttpError(409, 'A entrada da venda não se desfaz aqui', 'ENTRADA_NAO_DESFAZ')
        throw naoEncontrado('Recebimento não encontrado')
      }
      const dia = hoje()
      const feito = await dep.repo.emTransacao(async (tx) => {
        const venda = await tx.travarOperacao(op.alvo, op.id, escopo)
        if (!venda) throw naoEncontrado('Recebimento não encontrado')
        const t = await tx.travarTransacao(transacaoId)
        if (!t) throw naoEncontrado('Recebimento não encontrado')
        if (t.desfeita) throw new HttpError(409, 'Este recebimento já foi desfeito', 'JA_DESFEITO')
        if (s.perfil === 'COBRADOR' && (t.recebidoPor !== s.usuarioId || t.data !== dia)) throw semPermissao('O cobrador só desfaz o que ele mesmo recebeu hoje')
        // dia fechado é dia fechado: desfazer mudaria o dinheiro que o administrador conferiu (ou vai conferir)
        if (t.recebidoPor !== null) {
          await tx.travarCaixa(t.recebidoPor)
          if (await tx.diaFechado(t.recebidoPor, t.data)) throw new HttpError(409, 'O dia desse recebimento já foi fechado. Reabra o fechamento antes de desfazer.', 'DIA_FECHADO')
        }
        // só o último: desfazer um antigo bagunçaria o que veio depois
        if (!(await tx.ehUltimaDaOperacao(op.alvo, op.id, transacaoId))) throw new HttpError(409, op.alvo === 'VENDA' ? 'Só o último recebimento da venda pode ser desfeito' : 'Só o último recebimento do empréstimo pode ser desfeito', 'NAO_E_O_ULTIMO')

        const recs = await tx.recebimentosDaTransacao(op.alvo, transacaoId)
        // depois de um acordo, a parcela paga antes dele foi encerrada: desfazer o pagamento faria a dívida reaparecer em dobro
        if (recs.some((r) => r.encerradaPorAcordo)) throw new HttpError(409, 'Este pagamento é de antes de um acordo e não pode mais ser desfeito', 'ACORDO_FEITO')
        for (const r of recs) {
          if (!r.antes) throw new HttpError(409, 'Este recebimento não tem como ser desfeito', 'SEM_RETRATO')
          await tx.atualizarParcela(op.alvo, r.parcelaId, r.antes) // volta vencimento, desconto e quitação como estavam
        }
        // só juros: as parcelas que tiveram o juro recalculado voltam ao valor de antes
        for (const a of t.ajustes?.parcelas ?? []) await tx.atualizarParcela(op.alvo, a.parcelaId, a.antes)
        await tx.marcarDesfeita(transacaoId, s.usuarioId)
        const parcelas = await tx.parcelas(op.alvo, op.id) // agora sem esta transação
        await tx.definirStatus(op.alvo, op.id, parcelas.every((p) => falta(p) <= 0.009) ? 'QUITADA' : 'ATIVA')
        return { valor: t.valorTotal, parcelas: recs.map((r) => r.numero) }
      })
      await dep.auditoria.registrar({ usuarioId: s.usuarioId, acao: 'RECEBIMENTO_DESFEITO', entidade: op.alvo === 'VENDA' ? 'venda' : 'emprestimo', entidadeId: op.id, antes: { transacaoId, ...feito } })
    },

    async cobrancas(s, q) {
      const escopo = escopoLeitura(s)
      const aba = (q.aba ?? 'atrasadas') as Aba
      if (!ABAS.includes(aba)) throw requisicaoInvalida('aba inválida')
      const limite = Math.min(Math.max(Math.trunc(q.limite ?? 20) || 20, 1), LIMITE_MAX)
      const pagina = Math.max(Math.trunc(q.pagina ?? 1) || 1, 1)
      if (q.tipo !== undefined && q.tipo !== 'VENDA' && q.tipo !== 'EMPRESTIMO') throw requisicaoInvalida('tipo deve ser VENDA ou EMPRESTIMO')
      if (q.busca !== undefined && (typeof q.busca !== 'string' || q.busca.length > 80)) throw requisicaoInvalida('busca: no máximo 80 letras')
      const busca = q.busca?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() || undefined
      const dia = hoje()
      const r = await dep.repo.cobrancas(escopo, { aba, tipo: q.tipo as Alvo | undefined, busca, hoje: dia, limite, offset: (pagina - 1) * limite })
      const atraso = (l: LinhaCobranca) => (l.falta > 0.009 && l.vencimento < dia ? Math.round((Date.parse(dia) - Date.parse(l.vencimento)) / 864e5) : 0)
      return { ...r, itens: r.itens.map((l) => ({ ...l, atrasoDias: atraso(l) })), pagina, limite }
    },
  }
}
