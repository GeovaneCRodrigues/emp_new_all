<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { ContratoDetalheApi } from '@/api/contratos'
import { contratosApi } from '@/api/recursos'
import { useApp } from '@/composables/useApp'
import { dmyA } from '@/domain/format'
import Icon from './Icon.vue'
import Sheet from './Sheet.vue'

/** O contrato de uma venda: linha do tempo, o texto preenchido (o que falta aparece em laranja) e o que dá para fazer com ele. */
const props = defineProps<{ contratoId: number | null }>()
const emit = defineEmits<{ fechar: []; mudou: [] }>()
const { sessao } = useApp()

const d = ref<ContratoDetalheApi | null>(null)
const carregando = ref(false)
const enviando = ref(false)
const erro = ref('')
const copiado = ref(false)
const ehAdmin = computed(() => sessao.value.perfil === 'ADMIN')

let pedido = 0
async function carregar(id: number) {
  const meu = ++pedido
  carregando.value = true; erro.value = ''; d.value = null
  try { const r = await contratosApi.obter(sessao.value, id); if (meu === pedido) d.value = r } catch (e) { if (meu === pedido) erro.value = e instanceof ErroApi ? e.message : 'Não consegui abrir o contrato.' } finally { if (meu === pedido) carregando.value = false }
}
watch(() => props.contratoId, (id) => { copiado.value = false; if (id !== null) carregar(id); else d.value = null }, { immediate: true })

const status = computed(() => d.value?.contrato.status ?? 'AGUARDANDO')
const chip = computed(() => (status.value === 'ASSINADO' ? { cls: 'c-ok', txt: 'assinado' } : { cls: 'c-warn', txt: 'esperando assinatura' }))
const passos = computed(() => {
  const c = d.value?.contrato
  if (!c) return []
  return [
    { t: 'Gerado', sub: dmyA(c.geradoEm.slice(0, 10)), ok: true },
    { t: 'Enviado ao cliente', sub: c.enviadoEm ? dmyA(c.enviadoEm.slice(0, 10)) : 'ainda não enviado', ok: !!c.enviadoEm },
    { t: 'Assinado', sub: c.assinadoEm ? dmyA(c.assinadoEm.slice(0, 10)) : 'esperando o cliente', ok: !!c.assinadoEm },
  ]
})

async function acao(f: () => Promise<ContratoDetalheApi>) {
  enviando.value = true; erro.value = ''
  try { d.value = await f(); emit('mudou') } catch (e) { erro.value = e instanceof ErroApi ? e.message : 'Não consegui salvar.' } finally { enviando.value = false }
}
const enviado = () => acao(() => contratosApi.marcarEnviado(sessao.value, props.contratoId!))
const assinado = () => acao(() => contratosApi.marcarAssinado(sessao.value, props.contratoId!))
const seguro = (v: boolean) => acao(() => contratosApi.definirSeguro(sessao.value, props.contratoId!, v))

async function copiar() {
  if (!d.value) return
  try { await navigator.clipboard.writeText(d.value.texto); copiado.value = true; setTimeout(() => (copiado.value = false), 2000) } catch { erro.value = 'Não consegui copiar. Selecione o texto na tela.' }
}
/** Abre só o contrato numa janela limpa e chama a impressão (de lá dá para salvar em PDF). */
function imprimir() {
  if (!d.value) return
  const w = window.open('', '_blank')
  if (!w) { erro.value = 'O navegador bloqueou a janela de impressão. Libere pop-ups e tente de novo.'; return }
  w.document.title = `Contrato ${d.value.contrato.numero}`
  const pre = w.document.createElement('pre')
  pre.setAttribute('data-testid', 'contrato-impressao')
  pre.style.cssText = 'font:13px/1.6 ui-monospace,Menlo,monospace;white-space:pre-wrap;margin:24px'
  pre.textContent = d.value.texto
  w.document.body.appendChild(pre)
  w.focus(); w.print()
}
</script>

<template>
  <Sheet :aberto="contratoId !== null" @fechar="emit('fechar')">
    <div v-if="carregando" class="empty">Carregando…</div>
    <div v-else-if="erro && !d" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
    <template v-else-if="d">
      <div class="between" style="gap: 10px">
        <div style="min-width: 0"><h3 data-testid="ficha-numero">Contrato {{ d.contrato.numero }}</h3><div class="small">{{ d.contrato.clienteNome }} · {{ d.contrato.aparelho }}</div></div>
        <span class="chip" :class="chip.cls" data-testid="ficha-status">{{ chip.txt }}</span>
      </div>
      <div class="passos" data-testid="ficha-passos">
        <div v-for="p in passos" :key="p.t" :class="{ ok: p.ok }"><span class="dot"><Icon v-if="p.ok" name="check" small /></span><span><b>{{ p.t }}</b><span class="small" style="display: block">{{ p.sub }}</span></span></div>
      </div>
      <div v-if="d.faltam.length" class="aviso" data-testid="ficha-faltam"><Icon name="file-signature" small /><span>Falta cadastrar: {{ d.faltam.join(', ') }}. Complete no cadastro do cliente ou em Empresa e taxas para sair no contrato.</span></div>
      <div class="papel" style="margin-top: 12px" data-testid="ficha-texto"><template v-for="(t, i) in d.trechos" :key="i"><mark v-if="t.tipo === 'ok'">{{ t.v }}</mark><mark v-else-if="t.tipo === 'falta' || t.tipo === 'desconhecido'" class="f">{{ t.v }}</mark><template v-else>{{ t.v }}</template></template></div>
      <div v-if="d.congelado" class="small" style="margin-top: 8px" data-testid="ficha-congelado">Contrato enviado: o texto não muda mais, mesmo que o modelo ou o cadastro mudem.</div>
      <label v-else-if="ehAdmin" class="row" style="margin-top: 12px; gap: 8px; font-size: 14px"><input type="checkbox" :checked="d.contrato.seguro" :disabled="enviando" data-testid="ficha-seguro" @change="seguro(($event.target as HTMLInputElement).checked)" />Cliente contratou o seguro</label>
      <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); margin-top: 12px">{{ erro }}</div>
      <div style="display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap">
        <button v-if="status === 'AGUARDANDO'" class="btn b-ok" style="flex: 1" :disabled="enviando || d.faltam.length > 0" data-testid="ficha-enviado" @click="enviado"><Icon name="send" small />Marcar como enviado</button>
        <button v-else-if="status === 'ENVIADO' && ehAdmin" class="btn b-ok" style="flex: 1" :disabled="enviando" data-testid="ficha-assinado" @click="assinado"><Icon name="check" small />Cliente assinou</button>
        <button v-else-if="status === 'ASSINADO'" class="btn b-pri" style="flex: 1" data-testid="ficha-imprimir" @click="imprimir"><Icon name="receipt-text" small />Imprimir / salvar PDF</button>
        <button class="btn b-out" data-testid="ficha-copiar" @click="copiar"><Icon name="copy" small />{{ copiado ? 'Copiado!' : 'Copiar texto' }}</button>
        <button v-if="status !== 'ASSINADO'" class="btn b-ghost" data-testid="ficha-imprimir-2" @click="imprimir">Imprimir</button>
      </div>
      <div v-if="status === 'AGUARDANDO'" class="small" style="margin-top: 8px">Copie o texto, mande ao cliente (WhatsApp ou e-mail) e depois marque como enviado: aí o texto fecha. O envio automático pela ZapSign entra numa próxima etapa.</div>
      <div v-else-if="status === 'ENVIADO'" class="small" style="margin-top: 8px">Quando o cliente assinar, o administrador marca "Cliente assinou".</div>
    </template>
  </Sheet>
</template>
