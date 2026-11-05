import type { Sessao } from '@/domain/escopo'

/** Um aviso do sino. `rota` é a tela que ele abre (null: só informa). */
export interface NotificacaoApi { id: number; tipo: string; texto: string; rota: string | null; lida: boolean; criadaEm: string }
export interface ListaNotificacoesApi { itens: NotificacaoApi[]; naoLidas: number }

export interface NotificacoesApi {
  /** Os avisos de quem está logado, o mais novo primeiro. */
  listar(s: Sessao): Promise<ListaNotificacoesApi>
  marcarLida(s: Sessao, id: number): Promise<void>
  marcarTodas(s: Sessao): Promise<void>
}
