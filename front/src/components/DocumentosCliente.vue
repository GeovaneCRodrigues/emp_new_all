<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ErroApi, type DocumentoClienteApi, type TipoDocumento } from '@/api/clientes'
import { clientesApi } from '@/api/recursos'
import Icon from '@/components/Icon.vue'
import { useApp } from '@/composables/useApp'
import { useToast } from '@/composables/useToast'
import { prepararArquivo } from '@/domain/arquivo'
import { documentosFaltando, tamanhoLegivel, TIPOS_DOCUMENTO } from '@/domain/documentosCliente'

const props = defineProps<{ clienteId: number }>()
const emit = defineEmits<{ mudou: [docs: DocumentoClienteApi[]] }>()
const { sessao } = useApp()
const toast = useToast()

const docs = ref<DocumentoClienteApi[]>([])
const carregando = ref(false)
const erro = ref('')
const enviando = ref<TipoDocumento | null>(null)
const faltando = computed(() => documentosFaltando(docs.value))

let pedido = 0
async function carregar() {
  const meu = ++pedido
  carregando.value = true; erro.value = ''
  try {
    const r = await clientesApi.documentos(sessao.value, props.clienteId)
    if (meu !== pedido) return
    docs.value = r; emit('mudou', r)
  } catch (e) { if (meu === pedido) erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar os documentos.' } finally { if (meu === pedido) carregando.value = false }
}
watch(() => props.clienteId, () => { docs.value = []; carregar() }, { immediate: true })

async function escolhido(tipo: TipoDocumento, ev: Event) {
  const input = ev.target as HTMLInputElement
  const arquivos = [...(input.files ?? [])]
  input.value = '' // permite escolher o mesmo arquivo de novo
  if (!arquivos.length) return
  enviando.value = tipo
  try {
    for (const f of arquivos) await clientesApi.enviarDocumento(sessao.value, props.clienteId, tipo, await prepararArquivo(f))
    toast.ok(arquivos.length > 1 ? 'Documentos anexados.' : 'Documento anexado.')
  } catch (e) { toast.erro(e instanceof ErroApi ? e.message : 'Não consegui anexar o documento.') } finally { enviando.value = null }
  await carregar()
}

async function abrir(d: DocumentoClienteApi) {
  // a janela abre já, no toque (o celular bloqueia abrir depois de esperar a resposta)
  const janela = window.open('', '_blank')
  try {
    const url = URL.createObjectURL(await clientesApi.abrirDocumento(sessao.value, props.clienteId, d.id))
    if (janela) { janela.opener = null; janela.location.href = url } else window.location.href = url
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e) { janela?.close(); toast.erro(e instanceof ErroApi ? e.message : 'Não consegui abrir o documento.') }
}

async function remover(d: DocumentoClienteApi) {
  if (!window.confirm(`Remover "${d.nome}"?`)) return
  try { await clientesApi.removerDocumento(sessao.value, props.clienteId, d.id); toast.ok('Documento removido.') } catch (e) { toast.erro(e instanceof ErroApi ? e.message : 'Não consegui remover.') }
  await carregar()
}

const doTipo = (t: TipoDocumento) => docs.value.filter((d) => d.tipo === t)
</script>

<template>
  <section class="docs" data-testid="documentos-cliente" aria-label="Documentos do cliente">
    <div class="sec-t" style="margin: 16px 0 8px">
      <h2>Documentos</h2>
      <span v-if="!carregando && !erro" class="chip" :class="faltando.length ? 'c-warn' : 'c-ok'" data-testid="docs-situacao">{{ faltando.length ? `faltam ${faltando.length}` : 'completo' }}</span>
    </div>
    <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar()">Tentar de novo</button></div>
    <div v-else class="card pad docs-lista">
      <div v-for="t in TIPOS_DOCUMENTO" :key="t.tipo" class="doc-tipo" :data-tipo="t.tipo">
        <div class="doc-cab">
          <div><div class="val">{{ t.rotulo }}</div><div class="small">{{ t.dica }}</div></div>
          <label class="btn b-out b-sm" :class="{ 'b-off': enviando !== null }">
            <Icon name="plus" small />{{ enviando === t.tipo ? 'Enviando…' : 'Anexar' }}
            <input type="file" multiple accept="image/jpeg,image/png,application/pdf" class="so-leitor" :disabled="enviando !== null" :aria-label="`Anexar ${t.rotulo}`" @change="escolhido(t.tipo, $event)" />
          </label>
        </div>
        <ul v-if="doTipo(t.tipo).length" class="doc-itens">
          <li v-for="d in doTipo(t.tipo)" :key="d.id">
            <button class="doc-abrir" :title="`Abrir ${d.nome}`" @click="abrir(d)"><span class="doc-nome">{{ d.nome }}</span><span class="small">{{ tamanhoLegivel(d.tamanho) }}</span></button>
            <button class="btn b-ghost b-sm" :aria-label="`Remover ${d.nome}`" @click="remover(d)">Remover</button>
          </li>
        </ul>
        <div v-else-if="t.obrigatorio && !carregando" class="small doc-falta">Ainda não anexado</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.docs-lista { display: flex; flex-direction: column; gap: 14px }
.doc-cab { display: flex; justify-content: space-between; align-items: center; gap: 10px }
.doc-itens { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px }
.doc-itens li { display: flex; align-items: center; justify-content: space-between; gap: 8px }
.doc-abrir { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; text-align: left; background: none; border: 0; padding: 0; color: var(--text); cursor: pointer }
.doc-nome { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; text-decoration: underline }
.doc-falta { margin-top: 6px; color: var(--warn, var(--soft)) }
label.btn { position: relative; cursor: pointer }
.b-off { opacity: .6; pointer-events: none }
.so-leitor { position: absolute; inset: 0; opacity: 0; width: 100%; cursor: pointer }
</style>
