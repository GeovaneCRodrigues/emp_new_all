import type { Perfil, Sessao } from '../../../shared/perfis.js'
import { naoEncontrado } from '../../../shared/errors.js'
import type { FatoAuditado, Notificacao, NotificacoesRepository } from '../models/repository.js'

export type ListaNotificacoes = { itens: Notificacao[]; naoLidas: number }

export interface NotificacoesService {
  listar(s: Sessao): Promise<ListaNotificacoes>
  marcarLida(s: Sessao, id: number): Promise<void>
  marcarTodasLidas(s: Sessao): Promise<void>
  /** Transforma o que aconteceu desde a última vez em avisos. Seguro para rodar de tempos em tempos (não repete). */
  sincronizar(): Promise<void>
}

type Dependencias = {
  repo: NotificacoesRepository
  /** Quantas parcelas atrasadas e quantas vencem hoje, do ponto de vista de quem está olhando (o cobrador só vê a carteira dele). */
  atrasos: (s: Sessao) => Promise<{ atrasadas: number; hoje: number }>
  /** Hoje no fuso da loja, AAAA-MM-DD */
  hoje: () => string
  log?: (msg: string, err: unknown) => void
}

const LIMITE_LISTA = 50
const LOTE = 200
const brl = (v: unknown) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

const ASSINADO = ['CONTRATO_ASSINADO', 'CONTRATO_ASSINADO_PELO_LINK', 'CONTRATO_ASSINADO_ZAPSIGN']
const PEDIDOS = ['PROPOSTA_CRIADA', 'DESCONTO_PEDIDO', 'ACORDO_PEDIDO', 'RETOMADA_PEDIDA', 'BAIXA_AVISADA']
const ACOES = [...ASSINADO, ...PEDIDOS, 'RECEBIMENTO_REGISTRADO']
const PEDIDO_TEXTO: Record<string, string> = {
  PROPOSTA_CRIADA: 'Nova proposta de indicador esperando a loja.',
  DESCONTO_PEDIDO: 'Pedido de desconto esperando aprovação.',
  ACORDO_PEDIDO: 'Pedido de acordo esperando aprovação.',
  RETOMADA_PEDIDA: 'Pedido de retomada esperando aprovação.',
  BAIXA_AVISADA: 'Baixa avisada pelo cobrador esperando confirmação.',
}

export function createNotificacoesService(d: Dependencias): NotificacoesService {
  const log = d.log ?? (() => {})

  /** Escreve o aviso de um fato da auditoria. Devolve null quando o fato não gera aviso. */
  async function avisoDe(f: FatoAuditado): Promise<{ tipo: string; texto: string; rota: string; para: Perfil[] } | null> {
    if (ASSINADO.includes(f.acao)) {
      const c = await d.repo.contrato(f.entidadeId)
      return { tipo: 'contrato_assinado', texto: c ? `Contrato ${c.numero} assinado por ${c.cliente}.` : 'Um contrato foi assinado.', rota: '/contratos', para: ['ADMIN'] }
    }
    if (f.acao === 'RECEBIMENTO_REGISTRADO') {
      const cliente = f.entidade === 'venda' || f.entidade === 'emprestimo' ? await d.repo.clienteDaOperacao(f.entidade, f.entidadeId) : null
      const valor = f.depois?.valor
      return { tipo: 'pagamento', texto: `Recebido ${valor === undefined ? 'um pagamento' : brl(valor)}${cliente ? ` de ${cliente}` : ''}.`, rota: '/caixa', para: ['ADMIN'] }
    }
    if (PEDIDOS.includes(f.acao)) return { tipo: 'pedido', texto: PEDIDO_TEXTO[f.acao], rota: '/', para: ['ADMIN'] }
    return null
  }

  async function dosFatos() {
    let cursor = await d.repo.estado('auditoria')
    // primeira vez: só vale o que acontecer daqui para a frente (não avisa o passado)
    if (cursor === null) { await d.repo.gravarEstado('auditoria', await d.repo.ultimaAuditoria()); return }
    for (;;) {
      const fatos = await d.repo.auditoriaApos(cursor, ACOES, LOTE)
      if (fatos.length === 0) return
      for (const f of fatos) {
        const a = await avisoDe(f)
        if (a) {
          for (const u of await d.repo.usuariosAtivos(a.para)) {
            if (u.id === f.usuarioId) continue // quem fez a ação já sabe
            await d.repo.inserir({ usuarioId: u.id, tipo: a.tipo, texto: a.texto, rota: a.rota, chave: `aud:${f.id}` })
          }
        }
        cursor = f.id
        await d.repo.gravarEstado('auditoria', cursor)
      }
      if (fatos.length < LOTE) return
    }
  }

  /** Uma vez por dia: quantas parcelas atrasaram e quantas vencem hoje, para quem cobra. */
  async function dosAtrasos() {
    const dia = d.hoje()
    for (const u of await d.repo.usuariosAtivos(['ADMIN', 'COBRADOR'])) {
      const { atrasadas, hoje } = await d.atrasos({ sessaoId: 'notificacoes', usuarioId: u.id, perfil: u.perfil, indicadorId: null })
      const rota = u.perfil === 'ADMIN' ? '/cobrancas' : '/hoje'
      if (atrasadas > 0) await d.repo.inserir({ usuarioId: u.id, tipo: 'atraso', texto: `${plural(atrasadas, 'parcela atrasada', 'parcelas atrasadas')} para cobrar.`, rota, chave: `atrasadas:${dia}` })
      if (hoje > 0) await d.repo.inserir({ usuarioId: u.id, tipo: 'vencimento', texto: `${plural(hoje, 'parcela vence', 'parcelas vencem')} hoje.`, rota, chave: `vencem-hoje:${dia}` })
    }
  }

  return {
    async listar(s) {
      const [itens, naoLidas] = await Promise.all([d.repo.listar(s.usuarioId, LIMITE_LISTA), d.repo.naoLidas(s.usuarioId)])
      return { itens, naoLidas }
    },
    async marcarLida(s, id) {
      if (!(await d.repo.marcarLida(id, s.usuarioId))) throw naoEncontrado('Aviso não encontrado')
    },
    async marcarTodasLidas(s) { await d.repo.marcarTodas(s.usuarioId) },
    async sincronizar() {
      // uma parte que falha não derruba a outra (nem o servidor)
      try { await dosFatos() } catch (e) { log('notificações: falha ao ler os fatos', e) }
      try { await dosAtrasos() } catch (e) { log('notificações: falha ao contar os atrasos', e) }
    },
  }
}
