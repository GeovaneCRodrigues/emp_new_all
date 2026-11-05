/** Como o app conversa com o servidor sobre os avisos no celular (push). */
export interface ConfigPush { ligado: boolean; chavePublica: string | null }
/** O que o navegador devolve ao se inscrever (PushSubscription.toJSON). */
export interface InscricaoPush { endpoint: string; keys: { p256dh: string; auth: string } }

export interface PushApi {
  config(): Promise<ConfigPush>
  inscrever(i: InscricaoPush): Promise<void>
  cancelar(endpoint: string): Promise<void>
  /** Manda um aviso de teste aos aparelhos de quem está logado. */
  testar(): Promise<void>
}
