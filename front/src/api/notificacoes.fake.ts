import type { Sessao } from '@/domain/escopo'
import { ErroApi } from './clientes'
import type { NotificacaoApi, NotificacoesApi } from './notificacoes'

/** Versão de demonstração: cada perfil tem os próprios avisos, que ficam na memória. */
export function criarNotificacoesFake(agora: () => Date = () => new Date()): NotificacoesApi {
  let seq = 1
  const minutos = (n: number) => new Date(agora().getTime() - n * 60_000).toISOString()
  const novo = (tipo: string, texto: string, rota: string | null, antes: number, lida = false): NotificacaoApi => ({ id: seq++, tipo, texto, rota, lida, criadaEm: minutos(antes) })
  const porPerfil: Record<string, NotificacaoApi[]> = {
    ADMIN: [
      novo('contrato_assinado', 'Contrato 2026-0104 assinado por ANA SOUZA.', '/contratos', 12),
      novo('pagamento', 'Recebido R$ 1.250,50 de BRUNO LIMA.', '/caixa', 95),
      novo('pedido', 'Pedido de desconto esperando aprovação.', '/', 180),
      novo('atraso', '5 parcelas atrasadas para cobrar.', '/cobrancas', 26 * 60, true),
    ],
    COBRADOR: [novo('atraso', '3 parcelas atrasadas para cobrar.', '/hoje', 40), novo('vencimento', '2 parcelas vencem hoje.', '/hoje', 41)],
  }
  const meus = (s: Sessao) => (porPerfil[s.perfil] ??= [])
  return {
    async listar(s) {
      const itens = [...meus(s)].sort((a, b) => b.id - a.id).map((n) => ({ ...n }))
      return { itens, naoLidas: itens.filter((n) => !n.lida).length }
    },
    async marcarLida(s, id) {
      const n = meus(s).find((x) => x.id === id)
      if (!n) throw new ErroApi(404, 'Aviso não encontrado', 'NAO_ENCONTRADO')
      n.lida = true
    },
    async marcarTodas(s) { for (const n of meus(s)) n.lida = true },
  }
}
