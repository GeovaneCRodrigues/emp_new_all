import { computed, ref } from 'vue'
import { pushApi } from '@/api/recursos'
import { chaveParaNavegador } from '@/domain/pushChave'
import { situacaoPush } from '@/domain/situacaoPush'
import { useToast } from './useToast'

/**
 * Avisos no celular (push, com o app fechado e a tela bloqueada). O navegador só inscreve com o service worker
 * (que só existe na build de produção) e a permissão tem de ser pedida num toque. No iPhone só funciona com o
 * app instalado na Tela de Início.
 */
const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
const instalado = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
const suportado = () => import.meta.env.PROD && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

const servidorLigado = ref(false)
const chavePublica = ref<string | null>(null)
const inscrito = ref(false)
const permissao = ref<'default' | 'granted' | 'denied'>('default')
const ocupado = ref(false)
const pronto = ref(false)

export function usePush() {
  const toast = useToast()
  const situacao = computed(() => situacaoPush({ suportado: suportado(), servidorLigado: servidorLigado.value, ios: ios(), instalado: instalado(), permissao: permissao.value, inscrito: inscrito.value }))

  /** Lê o estado deste aparelho. Se ele já está inscrito, renova o vínculo com quem está logado agora (o aparelho pode ter trocado de dono). */
  async function carregar() {
    if (!suportado()) { pronto.value = true; return }
    try {
      const cfg = await pushApi.config()
      servidorLigado.value = cfg.ligado
      chavePublica.value = cfg.chavePublica
      permissao.value = Notification.permission
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription()
      inscrito.value = Boolean(sub)
      if (sub && cfg.ligado && Notification.permission === 'granted') await pushApi.inscrever(sub.toJSON() as never).catch(() => {})
    } catch { /* sem rede: o estado fica como estava */ } finally { pronto.value = true }
  }

  async function ativar() {
    if (!chavePublica.value || ocupado.value) return
    ocupado.value = true
    try {
      const p = await Notification.requestPermission()
      permissao.value = p
      if (p !== 'granted') { toast.erro('Permissão negada. Libere as notificações deste site nos ajustes do aparelho.'); return }
      const reg = await navigator.serviceWorker.ready
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaNavegador(chavePublica.value) as BufferSource }))
      await pushApi.inscrever(sub.toJSON() as never)
      inscrito.value = true
      await pushApi.testar().catch(() => {}) // confirma na hora que o aparelho está recebendo
      toast.ok('Avisos ativados neste aparelho.')
    } catch (e) {
      toast.erro(e instanceof Error && e.message ? e.message : 'Não consegui ativar os avisos.')
    } finally { ocupado.value = false }
  }

  async function desativar() {
    if (ocupado.value) return
    ocupado.value = true
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription()
      if (sub) { await pushApi.cancelar(sub.endpoint).catch(() => {}); await sub.unsubscribe() }
      inscrito.value = false
      toast.ok('Avisos desativados neste aparelho.')
    } catch (e) {
      toast.erro(e instanceof Error && e.message ? e.message : 'Não consegui desativar os avisos.')
    } finally { ocupado.value = false }
  }

  return { situacao, ocupado, pronto, carregar, ativar, desativar }
}
