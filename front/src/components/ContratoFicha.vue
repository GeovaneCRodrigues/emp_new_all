<script setup lang="ts">
import { copiarTexto } from '@/domain/copiar'
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
/** O link só aparece quando é gerado (o servidor guarda só o hash): fica aqui até fechar a ficha. */
const link = ref<{ url: string; expiraEm: string } | null>(null)
const linkCopiado = ref(false)
const cpfMascarado = (cpf: string) => `***.***.***-${cpf.slice(9)}`
const ehAdmin = computed(() => sessao.value.perfil === 'ADMIN')

let pedido = 0
async function carregar(id: number) {
  const meu = ++pedido
  carregando.value = true; erro.value = ''; d.value = null
  try { const r = await contratosApi.obter(sessao.value, id); if (meu === pedido) d.value = r } catch (e) { if (meu === pedido) erro.value = e instanceof ErroApi ? e.message : 'Não consegui abrir o contrato.' } finally { if (meu === pedido) carregando.value = false }
}
watch(() => props.contratoId, (id) => { copiado.value = false; link.value = null; linkCopiado.value = false; if (id !== null) carregar(id); else d.value = null }, { immediate: true })

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
async function gerarLink() {
  enviando.value = true; erro.value = ''
  try {
    const r = await contratosApi.gerarLink(sessao.value, props.contratoId!)
    d.value = r.contrato
    link.value = { url: `${window.location.origin}/assinar/${r.token}`, expiraEm: r.expiraEm }
    emit('mudou')
  } catch (e) { erro.value = e instanceof ErroApi ? e.message : 'Não consegui gerar o link.' } finally { enviando.value = false }
}
const primeiroNome = computed(() => (d.value?.contrato.clienteNome ?? '').split(' ')[0].toLowerCase().replace(/^./, (c) => c.toUpperCase()))
const mensagem = computed(() => `Olá, ${primeiroNome.value}! Segue o contrato ${d.value?.contrato.numero ?? ''} do seu ${d.value?.contrato.aparelho ?? 'aparelho'} para você ler e assinar pelo celular: ${link.value?.url ?? ''}`)
const whatsapp = computed(() => {
  const fone = d.value?.contrato.clienteFone ?? ''
  const destino = fone ? (fone.startsWith('55') && fone.length > 11 ? fone : `55${fone}`) : ''
  return `https://wa.me/${destino}?text=${encodeURIComponent(mensagem.value)}`
})
async function copiarLink() {
  if (!link.value) return
  if (await copiarTexto(link.value.url)) { linkCopiado.value = true; setTimeout(() => (linkCopiado.value = false), 2000) } else erro.value = 'Não consegui copiar. Selecione o link na tela.'
}
const seguro = (v: boolean) => acao(() => contratosApi.definirSeguro(sessao.value, props.contratoId!, v))

async function copiar() {
  if (!d.value) return
  if (await copiarTexto(d.value.texto)) { copiado.value = true; setTimeout(() => (copiado.value = false), 2000) } else erro.value = 'Não consegui copiar. Selecione o texto na tela.'
}
/** Abre só o contrato numa janela limpa e chama a impressão (de lá dá para salvar em PDF). */
function imprimir() {
  if (!d.value) return
  const w = window.open('', '_blank')
  if (!w) { erro.value = 'O navegador bloqueou a janela de impressão. Libere pop-ups e tente de novo.'; return }
  w.document.title = `Contrato ${d.value.contrato.numero}`
  // a logo da loja no alto (se não houver, a imagem falha e é removida)
  const logo = w.document.createElement('img')
  logo.src = contratosApi.logoSrc().startsWith('data:') ? contratosApi.logoSrc() : new URL(contratosApi.logoSrc(), window.location.origin).toString()
  logo.alt = ''; logo.setAttribute('data-testid', 'contrato-impressao-logo'); logo.style.cssText = 'display:block;max-height:70px;max-width:220px;margin:24px 24px 0;object-fit:contain'
  logo.onerror = () => logo.remove()
  if (contratosApi.logoSrc()) w.document.body.appendChild(logo)
  const pre = w.document.createElement('pre')
  pre.setAttribute('data-testid', 'contrato-impressao')
  pre.style.cssText = 'font:13px/1.6 ui-monospace,Menlo,monospace;white-space:pre-wrap;margin:24px'
  pre.textContent = d.value.texto
  w.document.body.appendChild(pre)
  const a = d.value.assinatura
  if (a) {
    const bloco = w.document.createElement('div')
    bloco.setAttribute('data-testid', 'contrato-impressao-assinatura')
    bloco.style.cssText = 'font:12px/1.5 ui-monospace,Menlo,monospace;margin:0 24px 24px;border-top:1px solid #999;padding-top:12px'
    const img = w.document.createElement('img')
    img.src = a.imagem; img.alt = 'Assinatura'; img.style.cssText = 'display:block;height:90px;margin-bottom:6px'
    const info = w.document.createElement('div')
    info.textContent = `Assinado eletronicamente por CPF ${cpfMascarado(a.cpf)} em ${new Date(a.assinadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · IP ${a.ip ?? '—'} · impressão digital do texto (SHA-256): ${a.textoHash}`
    bloco.append(img, info); w.document.body.appendChild(bloco)
  }
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
      <div v-if="d.assinatura" class="card pad" style="margin-top: 12px" data-testid="ficha-assinatura">
        <div class="lbl">Assinado pelo cliente</div>
        <img :src="d.assinatura.imagem" alt="Assinatura do cliente" style="display: block; max-width: 100%; height: 90px; object-fit: contain; background: #fff; border-radius: 8px; margin: 6px 0" />
        <div class="small">CPF {{ cpfMascarado(d.assinatura.cpf) }} · {{ new Date(d.assinatura.assinadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) }} · IP {{ d.assinatura.ip ?? '—' }}</div>
        <div class="small" style="overflow-wrap: anywhere">Impressão digital do texto (SHA-256): {{ d.assinatura.textoHash }}</div>
      </div>
      <div v-if="d.congelado" class="small" style="margin-top: 8px" data-testid="ficha-congelado">Contrato enviado: o texto não muda mais, mesmo que o modelo ou o cadastro mudem.</div>
      <label v-else-if="ehAdmin" class="row" style="margin-top: 12px; gap: 8px; font-size: 14px"><input type="checkbox" :checked="d.contrato.seguro" :disabled="enviando" data-testid="ficha-seguro" @change="seguro(($event.target as HTMLInputElement).checked)" />Cliente contratou o seguro</label>
      <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); margin-top: 12px">{{ erro }}</div>
      <div v-if="link" class="card pad" style="margin-top: 12px" data-testid="ficha-link">
        <div class="lbl">Link de assinatura (vale até {{ dmyA(link.expiraEm.slice(0, 10)) }})</div>
        <div class="mono small" style="overflow-wrap: anywhere; margin: 6px 0" data-testid="ficha-link-url">{{ link.url }}</div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap">
          <a class="btn b-ok" style="flex: 1; text-decoration: none; text-align: center" :href="whatsapp" target="_blank" rel="noopener" data-testid="ficha-link-whatsapp"><Icon name="send" small />Enviar pelo WhatsApp</a>
          <button class="btn b-out" type="button" data-testid="ficha-link-copiar" @click="copiarLink"><Icon name="copy" small />{{ linkCopiado ? 'Copiado!' : 'Copiar link' }}</button>
        </div>
        <div class="small" style="margin-top: 6px">Este link aparece só agora. Se perder, gere outro (o anterior deixa de valer).</div>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap">
        <button v-if="status !== 'ASSINADO'" class="btn b-pri" style="flex: 1" :disabled="enviando || d.faltam.length > 0" data-testid="ficha-gerar-link" @click="gerarLink"><Icon name="file-signature" small />{{ link || status === 'ENVIADO' ? 'Gerar novo link' : 'Gerar link de assinatura' }}</button>
        <button v-if="status === 'AGUARDANDO'" class="btn b-out" :disabled="enviando || d.faltam.length > 0" data-testid="ficha-enviado" @click="enviado"><Icon name="send" small />Marcar como enviado</button>
        <button v-if="status === 'ENVIADO' && ehAdmin" class="btn b-out" :disabled="enviando" data-testid="ficha-assinado" @click="assinado"><Icon name="check" small />Assinou fora do sistema</button>
        <button v-if="status === 'ASSINADO'" class="btn b-pri" style="flex: 1" data-testid="ficha-imprimir" @click="imprimir"><Icon name="receipt-text" small />Imprimir / salvar PDF</button>
        <button class="btn b-out" data-testid="ficha-copiar" @click="copiar"><Icon name="copy" small />{{ copiado ? 'Copiado!' : 'Copiar texto' }}</button>
        <button v-if="status !== 'ASSINADO'" class="btn b-ghost" data-testid="ficha-imprimir-2" @click="imprimir">Imprimir</button>
      </div>
      <div v-if="status === 'AGUARDANDO'" class="small" style="margin-top: 8px">Gere o link e mande pelo WhatsApp: o cliente lê, confirma o CPF e assina no celular. Ao gerar o link o texto fecha e o contrato vira "enviado".</div>
      <div v-else-if="status === 'ENVIADO'" class="small" style="margin-top: 8px">Esperando o cliente assinar pelo link. O contrato fica "assinado" sozinho quando ele terminar.</div>
    </template>
  </Sheet>
</template>
