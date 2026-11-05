import webpush from 'web-push'
import { requisicaoInvalida } from '../../../shared/errors.js'
import type { PushRepository } from '../models/repository.js'

export type AvisoPush = { titulo: string; texto: string; rota: string; tag: string }
export type ResultadoEnvio = { enviados: number; removidos: number; falhas: number }
export type InscricaoEntrada = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }

type Enviador = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, corpo: string, opcoes: webpush.RequestOptions) => Promise<unknown>

export interface PushService {
  /** Ligado só com as duas chaves VAPID no ambiente; sem elas nada é enviado. */
  ligado(): boolean
  chavePublica(): string | null
  inscrever(usuarioId: number, entrada: InscricaoEntrada, userAgent: string | null): Promise<void>
  cancelar(usuarioId: number, endpoint: unknown): Promise<void>
  /** Manda o aviso a todos os aparelhos da pessoa. Nunca lança: aviso que falha não pode derrubar quem o gerou. */
  enviar(usuarioId: number, aviso: AvisoPush): Promise<ResultadoEnvio>
}

type Dependencias = {
  repo: PushRepository
  chavePublica: string | null
  chavePrivada: string | null
  /** contato exigido pelo protocolo (mailto: ou https:) */
  assunto: string
  enviador?: Enviador
  log?: (msg: string, err: unknown) => void
}

const MAX_CAMPO = 2048
// O servidor faz POST no endereço que o aparelho informa: só os serviços de push dos navegadores entram (senão viraria SSRF).
const SERVICOS = ['googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com']

export function endpointPermitido(valor: string): boolean {
  let u: URL
  try { u = new URL(valor) } catch { return false }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  const h = u.hostname.toLowerCase()
  return SERVICOS.some((s) => h === s || h.endsWith(`.${s}`))
}

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export function createPushService(d: Dependencias): PushService {
  const log = d.log ?? (() => {})
  const ligado = Boolean(d.chavePublica && d.chavePrivada)
  const enviador: Enviador = d.enviador ?? ((sub, corpo, opcoes) => webpush.sendNotification(sub, corpo, opcoes))

  return {
    ligado: () => ligado,
    chavePublica: () => (ligado ? d.chavePublica : null),
    async inscrever(usuarioId, entrada, userAgent) {
      const endpoint = texto(entrada?.endpoint)
      const p256dh = texto(entrada?.keys?.p256dh)
      const auth = texto(entrada?.keys?.auth)
      if (!endpoint || !p256dh || !auth || [endpoint, p256dh, auth].some((v) => v.length > MAX_CAMPO)) throw requisicaoInvalida('Inscrição de aviso inválida')
      if (!endpointPermitido(endpoint)) throw requisicaoInvalida('Serviço de aviso não permitido')
      await d.repo.salvar({ usuarioId, endpoint, p256dh, auth, userAgent: userAgent ? userAgent.slice(0, 300) : null })
    },
    async cancelar(usuarioId, endpoint) {
      const e = texto(endpoint)
      if (!e) throw requisicaoInvalida('Informe o aparelho')
      await d.repo.remover(usuarioId, e)
    },
    async enviar(usuarioId, aviso) {
      const r: ResultadoEnvio = { enviados: 0, removidos: 0, falhas: 0 }
      if (!ligado) return r
      try {
        const corpo = JSON.stringify({ title: aviso.titulo, body: aviso.texto, url: aviso.rota, tag: aviso.tag })
        const opcoes: webpush.RequestOptions = {
          TTL: 60 * 60 * 12, timeout: 10_000,
          vapidDetails: { subject: d.assunto, publicKey: d.chavePublica!, privateKey: d.chavePrivada! },
        }
        await Promise.all((await d.repo.doUsuario(usuarioId)).map(async (i) => {
          try {
            await enviador({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } }, corpo, opcoes)
            r.enviados += 1
          } catch (e) {
            const status = (e as { statusCode?: number })?.statusCode
            if (status === 404 || status === 410) { await d.repo.apagar(i.id); r.removidos += 1 } // o aparelho desfez a inscrição
            else { r.falhas += 1; log(`push: falha ao enviar (inscrição ${i.id}, status ${status ?? '?'})`, e) }
          }
        }))
      } catch (e) { log('push: erro ao enviar', e) }
      return r
    },
  }
}
