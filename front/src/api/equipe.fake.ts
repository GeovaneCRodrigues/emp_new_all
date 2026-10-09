import { criarSeed } from '@/data/seed'
import { normalizarFone } from '@/domain/documentos'
import type { Sessao } from '@/domain/escopo'
import { arred2, maiusculas } from '@/domain/format'
import { falta } from '@/domain/recebimento'
import { problemaDoAcordo } from '@/domain/acordo'
import { nomeEmprestimo } from '@/domain/emprestimo'
import type { AprovacaoApi, AprovacoesApi, StatusAprovacao } from './aprovacoes'
import { ErroApi } from './clientes'
import type { EquipeApi, PessoaApi } from './equipe'
import type { CaixaApi, FechamentoApi, FechamentosApi } from './fechamentos'
import type { AcordosFake } from './acordos.fake'
import type { EmprestimosFake, RegistroEmprestimo } from './emprestimos.fake'
import type { AlvoApi } from './recebimentos'
import type { RecebimentosFake } from './recebimentos.fake'
import type { FechamentoReg, Pedido, Registro, VendasFake } from './vendas.fake'

const primeiro = (n: string) => n.trim().split(/\s+/)[0]
const adminOu = (s: Sessao) => { if (s.perfil !== 'ADMIN') throw new ErroApi(403, 'Só o administrador faz isso', 'SEM_PERMISSAO') }
const cobradorOu = (s: Sessao) => { if (s.perfil !== 'COBRADOR') throw new ErroApi(403, 'Só o cobrador tem o caixa do dia', 'SEM_PERMISSAO') }
const erro = (m: string) => new ErroApi(400, m)

// ===================== aprovações =====================

/** A venda ou o empréstimo de um pedido, visto de um jeito só. */
interface OpPedido {
  alvo: AlvoApi
  id: number
  cliente: { id: number; nome: string }
  descricao: string
  status: string
  parcelas: Registro['parcelas']
  definirStatus(status: 'ATIVA' | 'QUITADA'): void
}

/** Pedidos de desconto de demonstração: mesmas regras do backend (só o cobrador pede, só o admin responde, um pendente por parcela). */
export function criarAprovacoesFake(vendas: VendasFake, emprestimos?: EmprestimosFake, acordos?: AcordosFake, recebimentos?: RecebimentosFake): AprovacoesApi {
  const { pedidos, hoje } = vendas._interno
  const comoOp = (r: Registro): OpPedido => ({ alvo: 'VENDA', id: r.id, cliente: r.cliente, descricao: r.aparelho.modelo, status: r.status, parcelas: r.parcelas, definirStatus: (st) => { r.status = st } })
  const comoOpEmp = (r: RegistroEmprestimo): OpPedido => ({ alvo: 'EMPRESTIMO', id: r.id, cliente: r.cliente, descricao: nomeEmprestimo(r.modalidade, r.periodicidade), status: r.status, parcelas: r.parcelas, definirStatus: (st) => { r.status = st } })
  /** `s`: só as da carteira dele; sem `s`: todas. */
  const opDe = (alvo: AlvoApi, id: number, s?: Sessao): OpPedido | undefined => {
    if (alvo === 'VENDA') {
      const r = (s ? vendas._interno.noEscopo(s) : vendas._interno.registros).find((x) => x.id === id)
      return r ? comoOp(r) : undefined
    }
    const r = (s ? emprestimos?._interno.noEscopo(s) : emprestimos?._interno.registros)?.find((x) => x.id === id)
    return r ? comoOpEmp(r) : undefined
  }
  const visao = (p: Pedido): AprovacaoApi => {
    const o = opDe(p.alvo, p.operacaoId)!
    return {
      id: p.id, tipo: p.tipo, status: p.status, alvo: p.alvo, operacaoId: p.operacaoId, parcela: p.parcela, nParcelas: o.parcelas.length, valor: p.valor, motivo: p.motivo,
      solicitante: { id: p.solicitanteId, nome: p.solicitanteNome }, cliente: { id: o.cliente.id, nome: o.cliente.nome }, aparelho: o.descricao,
      acordo: p.tipo === 'ACORDO' && p.dados ? p.dados : null, baixa: p.tipo === 'BAIXA' && p.baixa ? p.baixa : null,
      criadaEm: p.criadaEm, respondidoPor: p.respondidoPor, respondidoEm: p.respondidoEm, resposta: p.resposta,
    }
  }
  const permitido = (s: Sessao) => { if (s.perfil !== 'ADMIN' && s.perfil !== 'COBRADOR' && s.perfil !== 'INDICADOR') throw new ErroApi(403, 'Só o administrador, o cobrador e o indicador usam os pedidos de aprovação', 'SEM_PERMISSAO') }
  // o indicador não tem usuário na demonstração: ganha um id próprio (longe dos ids de usuário) e o nome dele
  const nomesIndicador = new Map(criarSeed().indicadores.map((i) => [i.id, i.nome]))
  const idSolicitante = (s: Sessao) => (s.perfil === 'INDICADOR' ? 10_000 + (s.indicadorId ?? 0) : (s.usuarioId ?? 0))
  const nomeSolicitante = (s: Sessao) => (s.perfil === 'INDICADOR' ? (nomesIndicador.get(s.indicadorId ?? 0) ?? 'Indicador') : 'Diego Ramos')
  const achar = (id: number) => pedidos.find((x) => x.id === id) ?? (() => { throw new ErroApi(404, 'Pedido não encontrado', 'NAO_ENCONTRADO') })()
  const encerrada = (st: string) => st === 'RETOMADA' || st === 'CANCELADA'

  return {
    async pedirDesconto(s, e) {
      if (s.perfil !== 'COBRADOR' && s.perfil !== 'INDICADOR') throw new ErroApi(403, 'Só o cobrador e o indicador pedem desconto (o administrador dá o desconto direto ao receber)', 'SEM_PERMISSAO')
      const alvo = (e.alvo === undefined ? 'VENDA' : e.alvo) as AlvoApi
      if (alvo !== 'VENDA' && alvo !== 'EMPRESTIMO') throw erro('alvo deve ser VENDA ou EMPRESTIMO')
      if (!Number.isInteger(e.operacaoId) || e.operacaoId < 1) throw erro(alvo === 'VENDA' ? 'Informe a venda' : 'Informe o empréstimo')
      if (!Number.isInteger(e.parcela) || e.parcela < 1) throw erro('Informe a parcela')
      if (typeof e.valor !== 'number' || !Number.isFinite(e.valor) || e.valor <= 0) throw erro('Informe o valor do desconto')
      const motivo = (e.motivo ?? '').trim()
      if (motivo.length < 3 || motivo.length > 500) throw erro('Explique o motivo do pedido (de 3 a 500 letras)')
      const o = opDe(alvo, e.operacaoId, s)
      if (!o) throw new ErroApi(404, alvo === 'VENDA' ? 'Venda não encontrada' : 'Empréstimo não encontrado', 'NAO_ENCONTRADO')
      if (encerrada(o.status)) throw new ErroApi(409, alvo === 'VENDA' ? 'Esta venda foi retomada ou cancelada' : 'Este empréstimo foi cancelado', 'VENDA_ENCERRADA')
      const p = o.parcelas.find((x) => x.numero === e.parcela)
      if (!p) throw new ErroApi(404, 'Parcela não encontrada', 'NAO_ENCONTRADO')
      const f = falta(p)
      if (f <= 0.009) throw new ErroApi(409, 'Esta parcela já está paga', 'PARCELA_PAGA')
      const valor = arred2(e.valor)
      if (valor > f + 0.009) throw erro('O desconto não pode passar do que falta na parcela')
      if (pedidos.some((x) => x.tipo === 'DESCONTO' && x.alvo === alvo && x.operacaoId === o.id && x.parcela === e.parcela && x.status === 'PENDENTE')) throw new ErroApi(409, 'Já existe um pedido de desconto esperando para esta parcela', 'PEDIDO_JA_EXISTE')
      const novo: Pedido = { id: vendas._interno.proximoPedido(), tipo: 'DESCONTO', alvo, operacaoId: o.id, parcela: e.parcela, valor, motivo, solicitanteId: idSolicitante(s), solicitanteNome: nomeSolicitante(s), status: 'PENDENTE', criadaEm: `${hoje}T12:00:00.000Z`, respondidoPor: null, respondidoEm: null, resposta: null }
      pedidos.push(novo)
      return visao(novo)
    },

    async pedirBaixa(s, e) {
      if (s.perfil !== 'INDICADOR') throw new ErroApi(403, 'Só o indicador avisa que recebeu (a loja confirma e dá a baixa)', 'SEM_PERMISSAO')
      const alvo = (e.alvo === undefined ? 'VENDA' : e.alvo) as AlvoApi
      if (alvo !== 'VENDA' && alvo !== 'EMPRESTIMO') throw erro('alvo deve ser VENDA ou EMPRESTIMO')
      if (!Number.isInteger(e.operacaoId) || e.operacaoId < 1) throw erro(alvo === 'VENDA' ? 'Informe a venda' : 'Informe o empréstimo')
      if (!Number.isInteger(e.parcela) || e.parcela < 1) throw erro('Informe a parcela')
      if (typeof e.valor !== 'number' || !Number.isFinite(e.valor) || e.valor <= 0 || e.valor > 1e8) throw erro('Informe quanto você recebeu')
      if (e.forma !== 'PIX' && e.forma !== 'DINHEIRO' && e.forma !== 'CARTAO') throw erro('Informe a forma de pagamento (PIX, DINHEIRO ou CARTAO)')
      const data = e.data ?? hoje
      if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data) || new Date(data + 'T12:00:00Z').toISOString().slice(0, 10) !== data) throw erro('data precisa ser uma data válida (AAAA-MM-DD)')
      if (data > hoje) throw erro('A data do recebimento não pode ser no futuro')
      let comprovante: string | null = null
      if (e.comprovante !== undefined && e.comprovante !== '') {
        if (typeof e.comprovante !== 'string' || e.comprovante.trim().length > 120) throw erro('comprovante: no máximo 120 letras')
        comprovante = e.comprovante.trim() || null
      }
      let motivo = ''
      if (e.motivo !== undefined && e.motivo !== '') {
        if (typeof e.motivo !== 'string' || e.motivo.trim().length > 500) throw erro('observação: no máximo 500 letras')
        motivo = e.motivo.trim()
      }
      const o = opDe(alvo, e.operacaoId, s) // fora das operações dele: 404
      if (!o) throw new ErroApi(404, alvo === 'VENDA' ? 'Venda não encontrada' : 'Empréstimo não encontrado', 'NAO_ENCONTRADO')
      if (encerrada(o.status)) throw new ErroApi(409, alvo === 'VENDA' ? 'Esta venda foi retomada ou cancelada' : 'Este empréstimo foi cancelado', 'VENDA_ENCERRADA')
      const p = o.parcelas.find((x) => x.numero === e.parcela)
      if (!p) throw new ErroApi(404, 'Parcela não encontrada', 'NAO_ENCONTRADO')
      const f = falta(p)
      if (f <= 0.009) throw new ErroApi(409, 'Esta parcela já está paga', 'PARCELA_PAGA')
      const valor = arred2(e.valor)
      if (valor > f + 0.009) throw erro('O valor não pode passar do que falta na parcela')
      if (pedidos.some((x) => x.tipo === 'BAIXA' && x.alvo === alvo && x.operacaoId === o.id && x.parcela === e.parcela && x.status === 'PENDENTE')) throw new ErroApi(409, 'Já existe um aviso de recebimento esperando a loja para esta parcela', 'PEDIDO_JA_EXISTE')
      const novo: Pedido = { id: vendas._interno.proximoPedido(), tipo: 'BAIXA', alvo, operacaoId: o.id, parcela: e.parcela, valor, motivo, baixa: { forma: e.forma, data, comprovante }, solicitanteId: idSolicitante(s), solicitanteNome: nomeSolicitante(s), status: 'PENDENTE', criadaEm: `${hoje}T12:00:00.000Z`, respondidoPor: null, respondidoEm: null, resposta: null }
      pedidos.push(novo)
      return visao(novo)
    },

    async pedirRetomada(s, e) {
      if (s.perfil !== 'COBRADOR') throw new ErroApi(403, 'Só o cobrador pede a retomada (o administrador retoma direto na venda)', 'SEM_PERMISSAO')
      if (!Number.isInteger(e.operacaoId) || e.operacaoId < 1) throw erro('Informe a venda')
      const motivo = (e.motivo ?? '').trim()
      if (motivo.length < 3 || motivo.length > 500) throw erro('Explique o motivo do pedido (de 3 a 500 letras)')
      const o = opDe('VENDA', e.operacaoId, s)
      if (!o) throw new ErroApi(404, 'Venda não encontrada', 'NAO_ENCONTRADO')
      if (o.status !== 'ATIVA') throw new ErroApi(409, 'Só dá para pedir a retomada de uma venda em andamento', 'VENDA_NAO_RETOMAVEL')
      const abertas = o.parcelas.filter((p) => falta(p) > 0.009)
      if (!abertas.some((p) => p.vencimento < hoje)) throw new ErroApi(409, 'Só dá para pedir a retomada quando o cliente tem parcela atrasada', 'SEM_ATRASO')
      if (pedidos.some((x) => x.tipo === 'RETOMADA' && x.operacaoId === o.id && x.status === 'PENDENTE')) throw new ErroApi(409, 'Já existe um pedido de retomada esperando para esta venda', 'PEDIDO_JA_EXISTE')
      const novo: Pedido = { id: vendas._interno.proximoPedido(), tipo: 'RETOMADA', alvo: 'VENDA', operacaoId: o.id, parcela: null, valor: arred2(abertas.reduce((x, p) => x + falta(p), 0)), motivo, solicitanteId: s.usuarioId ?? 0, solicitanteNome: 'Diego Ramos', status: 'PENDENTE', criadaEm: `${hoje}T12:00:00.000Z`, respondidoPor: null, respondidoEm: null, resposta: null }
      pedidos.push(novo)
      return visao(novo)
    },

    async pedirAcordo(s, e) {
      if (s.perfil !== 'COBRADOR') throw new ErroApi(403, 'Só o cobrador pede o acordo (o administrador faz o acordo direto na ficha)', 'SEM_PERMISSAO')
      const alvo = (e.alvo === undefined ? 'VENDA' : e.alvo) as AlvoApi
      if (alvo !== 'VENDA' && alvo !== 'EMPRESTIMO') throw erro('alvo deve ser VENDA ou EMPRESTIMO')
      if (!Number.isInteger(e.operacaoId) || e.operacaoId < 1) throw erro(alvo === 'VENDA' ? 'Informe a venda' : 'Informe o empréstimo')
      const motivo = (e.motivo ?? '').trim()
      if (motivo.length < 3 || motivo.length > 500) throw erro('Explique o motivo do pedido (de 3 a 500 letras)')
      const problema = problemaDoAcordo({ valorTotal: e.valorTotal, parcelas: e.parcelas, primeiraParcela: e.primeiraParcela }, hoje)
      if (problema) throw erro(problema)
      const o = opDe(alvo, e.operacaoId, s)
      if (!o) throw new ErroApi(404, alvo === 'VENDA' ? 'Venda não encontrada' : 'Empréstimo não encontrado', 'NAO_ENCONTRADO')
      if (encerrada(o.status)) throw new ErroApi(409, alvo === 'VENDA' ? 'Esta venda foi retomada ou cancelada' : 'Este empréstimo foi cancelado', 'VENDA_ENCERRADA')
      const saldo = arred2(o.parcelas.reduce((x, p) => x + Math.max(0, falta(p)), 0))
      if (o.status !== 'ATIVA' || saldo <= 0.009) throw new ErroApi(409, 'Não há nada em aberto para renegociar', 'SEM_SALDO')
      if (pedidos.some((x) => x.tipo === 'ACORDO' && x.alvo === alvo && x.operacaoId === o.id && x.status === 'PENDENTE')) throw new ErroApi(409, 'Já existe um pedido de acordo esperando para esta operação', 'PEDIDO_JA_EXISTE')
      const novo: Pedido = { id: vendas._interno.proximoPedido(), tipo: 'ACORDO', alvo, operacaoId: o.id, parcela: null, valor: arred2(e.valorTotal), motivo, solicitanteId: s.usuarioId ?? 0, solicitanteNome: 'Diego Ramos', status: 'PENDENTE', criadaEm: `${hoje}T12:00:00.000Z`, respondidoPor: null, respondidoEm: null, resposta: null, dados: { parcelas: e.parcelas, primeiraParcela: e.primeiraParcela, saldoNoPedido: saldo } }
      pedidos.push(novo)
      return visao(novo)
    },

    async listar(s, q) {
      permitido(s)
      if (q.status && !['PENDENTE', 'APROVADO', 'RECUSADO'].includes(q.status)) throw erro('status inválido')
      const limite = Math.min(Math.max(q.limite ?? 20, 1), 100)
      const pagina = Math.max(q.pagina ?? 1, 1)
      const meus = pedidos.filter((p) => s.perfil === 'ADMIN' || p.solicitanteId === idSolicitante(s))
      const ordem = (a: Pedido, b: Pedido) => (a.status === 'PENDENTE') !== (b.status === 'PENDENTE') ? (a.status === 'PENDENTE' ? -1 : 1) : a.status === 'PENDENTE' ? a.criadaEm.localeCompare(b.criadaEm) : (b.respondidoEm ?? '').localeCompare(a.respondidoEm ?? '') || b.id - a.id
      const filtrados = meus.filter((p) => !q.status || p.status === q.status).sort(ordem)
      return { itens: filtrados.slice((pagina - 1) * limite, pagina * limite).map(visao), total: filtrados.length, pendentes: meus.filter((p) => p.status === 'PENDENTE').length, pagina, limite }
    },

    async aprovar(s, id, e) {
      adminOu(s)
      const p = achar(id)
      if (p.status !== 'PENDENTE') throw new ErroApi(409, 'Este pedido já foi respondido', 'PEDIDO_JA_RESPONDIDO')
      const o = opDe(p.alvo, p.operacaoId)!
      if (encerrada(o.status)) throw new ErroApi(409, p.alvo === 'VENDA' ? 'Esta venda foi retomada ou cancelada' : 'Este empréstimo foi cancelado', 'VENDA_ENCERRADA')
      if (p.tipo === 'BAIXA') {
        // vira recebimento (recebido pelo indicador) e o recibo sai; a loja decide o resto se veio menos que a parcela
        if (!recebimentos || !p.baixa) throw new ErroApi(409, 'Confirmação de baixa indisponível', 'PEDIDO_DESATUALIZADO')
        const r = await recebimentos._interno.registrarComo({ perfil: 'ADMIN', usuarioId: 1 }, { id: p.solicitanteId, nome: p.solicitanteNome }, p.alvo, p.operacaoId,
          { parcela: p.parcela!, valor: p.valor, forma: p.baixa.forma, data: p.baixa.data, ...(e?.resto ? { resto: e.resto } : {}), ...(e?.novoVencimento ? { novoVencimento: e.novoVencimento } : {}) }, p.id)
        p.status = 'APROVADO'; p.respondidoPor = 'Geovane Cataneo'; p.respondidoEm = `${hoje}T12:00:00.000Z`
        return { ...visao(p), recibo: r.recibo }
      }
      if (p.tipo === 'ACORDO') {
        if (!acordos || !p.dados) throw new ErroApi(409, 'Pedido de acordo sem proposta', 'PEDIDO_DESATUALIZADO')
        if (p.dados.primeiraParcela < hoje) throw new ErroApi(409, 'A data da 1ª parcela proposta já passou. Recuse o pedido e peça de novo.', 'PEDIDO_DESATUALIZADO')
        acordos._interno.fazerAcordo({ alvo: p.alvo, operacaoId: o.id, usuarioNome: 'Geovane Cataneo', valorTotal: p.valor, n: p.dados.parcelas, primeira: p.dados.primeiraParcela, motivo: p.motivo, aprovacaoId: p.id, saldoEsperado: p.dados.saldoNoPedido })
        p.status = 'APROVADO'; p.respondidoPor = 'Geovane Cataneo'; p.respondidoEm = `${hoje}T12:00:00.000Z`
        return visao(p)
      }
      if (p.tipo === 'RETOMADA') {
        try { vendas._interno.retomarRegistro(o.id, s.usuarioId ?? 1, p.motivo, p.id) }
        catch (err) { if (err instanceof ErroApi && err.codigo === 'SEM_ATRASO') throw new ErroApi(409, 'O cliente já não tem parcela atrasada: recuse o pedido', 'PEDIDO_DESATUALIZADO'); throw err }
        p.status = 'APROVADO'; p.respondidoPor = 'Geovane Cataneo'; p.respondidoEm = `${hoje}T12:00:00.000Z`
        return visao(p)
      }
      const parc = o.parcelas.find((x) => x.numero === p.parcela)!
      const f = falta(parc)
      if (p.valor > f + 0.009) throw new ErroApi(409, f <= 0.009 ? 'A parcela já foi paga: o pedido não faz mais sentido' : `A parcela mudou: agora faltam só ${f.toFixed(2).replace('.', ',')}. Recuse o pedido e peça de novo.`, 'PEDIDO_DESATUALIZADO')
      parc.desconto = arred2(parc.desconto + p.valor)
      if (arred2(f - p.valor) <= 0.009) parc.quitadaEm = hoje
      o.definirStatus(o.parcelas.every((x) => falta(x) <= 0.009) ? 'QUITADA' : 'ATIVA')
      p.status = 'APROVADO'; p.respondidoPor = 'Geovane Cataneo'; p.respondidoEm = `${hoje}T12:00:00.000Z`
      return visao(p)
    },

    async recusar(s, id, motivo) {
      adminOu(s)
      const p = achar(id)
      if (p.status !== 'PENDENTE') throw new ErroApi(409, 'Este pedido já foi respondido', 'PEDIDO_JA_RESPONDIDO')
      p.status = 'RECUSADO'; p.respondidoPor = 'Geovane Cataneo'; p.respondidoEm = `${hoje}T12:00:00.000Z`; p.resposta = motivo?.trim() ? motivo.trim().slice(0, 500) : null
      return visao(p)
    },
  }
}

// ===================== fechamentos =====================

export function criarFechamentosFake(vendas: VendasFake): FechamentosApi {
  const { transacoes, fechamentos, hoje } = vendas._interno
  const visao = (f: FechamentoReg): FechamentoApi => ({
    id: f.id, usuario: { id: f.usuarioId, nome: f.usuarioNome }, data: f.data, totalDinheiro: f.dinheiro, totalPix: f.pix, totalCartao: f.cartao,
    total: arred2(f.dinheiro + f.pix + f.cartao), status: f.status, conferidoPor: f.conferidoPor, conferidoEm: f.conferidoEm,
  })
  const doDia = (usuarioId: number, data: string) => transacoes.filter((t) => t.recebidoPorId === usuarioId && t.data === data && !t.desfeita)
  const soma = (usuarioId: number, data: string, forma: string) => arred2(doDia(usuarioId, data).filter((t) => t.forma === forma).reduce((x, t) => x + t.valor, 0))

  return {
    async hoje(s) {
      cobradorOu(s)
      const u = s.usuarioId ?? 0
      const [d, p, c] = [soma(u, hoje, 'DINHEIRO'), soma(u, hoje, 'PIX'), soma(u, hoje, 'CARTAO')]
      const f = fechamentos.find((x) => x.usuarioId === u && x.data === hoje)
      const caixa: CaixaApi = {
        data: hoje, dinheiro: d, pix: p, cartao: c, total: arred2(d + p + c), fechamento: f ? visao(f) : null,
        recebimentos: doDia(u, hoje).sort((a, b) => b.id - a.id).map((t) => ({ transacaoId: t.id, numero: String(t.numero).padStart(6, '0'), cliente: t.clienteNome, valor: t.valor, forma: t.forma, referencia: t.resumo.referencia })),
      }
      return caixa
    },

    async fechar(s) {
      cobradorOu(s)
      const u = s.usuarioId ?? 0
      if (fechamentos.some((x) => x.usuarioId === u && x.data === hoje)) throw new ErroApi(409, 'O dia já foi fechado. Peça ao administrador para reabrir, se precisar lançar mais alguma coisa.', 'DIA_JA_FECHADO')
      const f: FechamentoReg = { id: vendas._interno.proximoFechamento(), usuarioId: u, usuarioNome: 'Diego Ramos', data: hoje, dinheiro: soma(u, hoje, 'DINHEIRO'), pix: soma(u, hoje, 'PIX'), cartao: soma(u, hoje, 'CARTAO'), status: 'PENDENTE', conferidoPor: null, conferidoEm: null }
      fechamentos.push(f)
      return visao(f)
    },

    async listar(s, q) {
      if (s.perfil !== 'ADMIN' && s.perfil !== 'COBRADOR') throw new ErroApi(403, 'Você não tem acesso aos fechamentos', 'SEM_PERMISSAO')
      if (q.status && q.status !== 'PENDENTE' && q.status !== 'CONFERIDO') throw erro('status inválido')
      const limite = Math.min(Math.max(q.limite ?? 20, 1), 100)
      const pagina = Math.max(q.pagina ?? 1, 1)
      const meus = fechamentos.filter((f) => s.perfil === 'ADMIN' || f.usuarioId === s.usuarioId)
      const filtrados = meus.filter((f) => !q.status || f.status === q.status).sort((a, b) => (a.status === 'PENDENTE') !== (b.status === 'PENDENTE') ? (a.status === 'PENDENTE' ? -1 : 1) : b.data.localeCompare(a.data) || b.id - a.id)
      return { itens: filtrados.slice((pagina - 1) * limite, pagina * limite).map(visao), total: filtrados.length, pendentes: meus.filter((f) => f.status === 'PENDENTE').length, pagina, limite }
    },

    async conferir(s, id) {
      adminOu(s)
      const f = fechamentos.find((x) => x.id === id)
      if (!f) throw new ErroApi(404, 'Fechamento não encontrado', 'NAO_ENCONTRADO')
      if (f.status !== 'PENDENTE') throw new ErroApi(409, 'Este fechamento já foi conferido', 'JA_CONFERIDO')
      f.status = 'CONFERIDO'; f.conferidoPor = 'Geovane Cataneo'; f.conferidoEm = `${hoje}T12:00:00.000Z`
      return visao(f)
    },

    async reabrir(s, id) {
      adminOu(s)
      const i = fechamentos.findIndex((x) => x.id === id)
      if (i < 0) throw new ErroApi(404, 'Fechamento não encontrado', 'NAO_ENCONTRADO')
      if (fechamentos[i].status !== 'PENDENTE') throw new ErroApi(409, 'Fechamento já conferido não se reabre', 'JA_CONFERIDO')
      fechamentos.splice(i, 1)
    },
  }
}

// ===================== equipe =====================

interface Usuario { id: number; nome: string; email: string; perfil: PessoaApi['perfil']; fone: string | null; ativo: boolean }

export function criarEquipeFake(vendas: VendasFake): EquipeApi {
  const seed = criarSeed()
  let proximoId = 100
  const usuarios: Usuario[] = [
    { id: 1, nome: 'Geovane Cataneo', email: 'admin@demo.com', perfil: 'ADMIN', fone: '11990001100', ativo: true },
    { id: 2, nome: 'Bruna Teixeira', email: 'vendedor@demo.com', perfil: 'VENDEDOR', fone: '11981234455', ativo: true },
    { id: 3, nome: 'Diego Ramos', email: 'cobrador@demo.com', perfil: 'COBRADOR', fone: '11977882201', ativo: true },
  ]
  const { hoje, registros, transacoes, pedidos } = vendas._interno
  const mes = hoje.slice(0, 7)

  const pessoa = (u: Usuario): PessoaApi => {
    const carteira = seed.clientes.filter((c) => c.responsavelId === u.id)
    const comAtraso = carteira.filter((c) => registros.some((r) => r.cliente.id === c.id && r.status !== 'RETOMADA' && r.status !== 'CANCELADA' && r.parcelas.some((p) => falta(p) > 0.009 && p.vencimento < hoje))).length
    return {
      id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, fone: u.fone, ativo: u.ativo, carteira: carteira.length, comAtraso,
      recebidoNoMes: arred2(transacoes.filter((t) => t.recebidoPorId === u.id && !t.desfeita && t.data.slice(0, 7) === mes).reduce((x, t) => x + t.valor, 0)),
      vendasNoMes: registros.filter((r) => r.vendedorId === u.id && r.status !== 'CANCELADA' && r.dataVenda.slice(0, 7) === mes).length,
      pedidosPendentes: pedidos.filter((p) => p.solicitanteId === u.id && p.status === 'PENDENTE').length,
    }
  }
  const ordem = (p: PessoaApi) => ['ADMIN', 'COBRADOR', 'VENDEDOR'].indexOf(p.perfil)

  return {
    async listar(s) { adminOu(s); return usuarios.map(pessoa).sort((a, b) => ordem(a) - ordem(b) || a.nome.localeCompare(b.nome, 'pt-BR')) },

    async convidar(s, e) {
      adminOu(s)
      if (typeof e.nome !== 'string' || e.nome.trim().length < 2 || e.nome.trim().length > 160) throw erro('Informe o nome (ao menos 2 letras)')
      const email = (e.email ?? '').trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw erro('E-mail inválido')
      if (e.perfil !== 'VENDEDOR' && e.perfil !== 'COBRADOR') throw erro('O perfil deve ser VENDEDOR ou COBRADOR')
      let fone: string | null = null
      if (e.fone) { fone = normalizarFone(e.fone); if (!fone) throw erro('Telefone inválido. Use DDD + número, por exemplo (11) 98812-4410') }
      if (usuarios.some((u) => u.email === email)) throw new ErroApi(409, 'Já existe um usuário com esse e-mail', 'EMAIL_EM_USO')
      const u: Usuario = { id: ++proximoId, nome: maiusculas(e.nome), email, perfil: e.perfil, fone, ativo: true }
      usuarios.push(u)
      // no modo demonstração a senha é só para ver como fica; o login falso não a reconhece
      const bytes = crypto.getRandomValues(new Uint8Array(10))
      return { id: u.id, email, senhaTemporaria: btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 13) }
    },

    async atualizar(s, id, e) {
      adminOu(s)
      const u = usuarios.find((x) => x.id === id)
      if (!u) throw new ErroApi(404, 'Pessoa não encontrada', 'NAO_ENCONTRADO')
      if (u.perfil === 'ADMIN') throw new ErroApi(403, 'O administrador não é alterado por aqui', 'SEM_PERMISSAO')
      if ('nome' in e && (typeof e.nome !== 'string' || e.nome.trim().length < 2 || e.nome.trim().length > 160)) throw erro('Informe o nome (ao menos 2 letras)')
      let fone: string | null | undefined
      if ('fone' in e) { if (!e.fone) fone = null; else { fone = normalizarFone(e.fone); if (!fone) throw erro('Telefone inválido. Use DDD + número, por exemplo (11) 98812-4410') } }
      if ('ativo' in e && typeof e.ativo !== 'boolean') throw erro('ativo deve ser verdadeiro ou falso')
      if (e.ativo === false && id === s.usuarioId) throw erro('Você não pode desativar o seu próprio acesso')
      if ('nome' in e) u.nome = maiusculas(e.nome!)
      if (fone !== undefined) u.fone = fone
      if (typeof e.ativo === 'boolean') u.ativo = e.ativo
      return pessoa(u)
    },
  }
}

export { primeiro }
export type { StatusAprovacao }
