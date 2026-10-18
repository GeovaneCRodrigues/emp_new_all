<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EmprestimoApi } from '@/api/emprestimos'
import type { PagamentoApi } from '@/api/recebimentos'
import { detalhamentoEmprestimo, type ModoDetalhamento } from '@/domain/detalhamento'
import Icon from './Icon.vue'
import Sheet from './Sheet.vue'

/** Texto do empréstimo para mandar ao cliente: simplificado ou extenso. Copia ou abre o WhatsApp. */
const props = defineProps<{ aberto: boolean; emprestimo: EmprestimoApi | null; pagamentos: PagamentoApi[]; hoje: string }>()
const emit = defineEmits<{ fechar: [] }>()
const modo = ref<ModoDetalhamento>('SIMPLES')
const copiado = ref(false)
watch(() => props.aberto, (a) => { if (a) { modo.value = 'SIMPLES'; copiado.value = false } })
const texto = computed(() => (props.emprestimo ? detalhamentoEmprestimo(props.emprestimo, props.pagamentos, props.hoje, modo.value) : ''))
const linkWhats = computed(() => `https://wa.me/?text=${encodeURIComponent(texto.value)}`)
async function copiar() {
  try { await navigator.clipboard.writeText(texto.value); copiado.value = true; setTimeout(() => (copiado.value = false), 2000) } catch { /* o texto está na tela */ }
}
</script>

<template>
  <Sheet :aberto="aberto" @fechar="emit('fechar')">
    <template v-if="emprestimo">
      <h3>Detalhamento para o cliente</h3>
      <div class="small">{{ emprestimo.cliente.nome }} · sem capital, lucro nem indicador</div>
      <div class="row" style="gap: 8px; margin-top: 12px" role="tablist">
        <button class="btn" :class="modo === 'SIMPLES' ? 'b-ok' : 'b-out'" role="tab" :aria-selected="modo === 'SIMPLES'" data-modo="SIMPLES" @click="modo = 'SIMPLES'">Simplificado</button>
        <button class="btn" :class="modo === 'EXTENSO' ? 'b-ok' : 'b-out'" role="tab" :aria-selected="modo === 'EXTENSO'" data-modo="EXTENSO" @click="modo = 'EXTENSO'">Extenso</button>
      </div>
      <pre class="texto card pad" data-testid="detalhamento-texto">{{ texto }}</pre>
      <div class="row" style="gap: 8px; margin-top: 10px">
        <button class="btn b-out" style="flex: 1" data-copiar @click="copiar"><Icon name="copy" small /> {{ copiado ? 'Copiado!' : 'Copiar' }}</button>
        <a class="btn b-ok" style="flex: 1" :href="linkWhats" target="_blank" rel="noopener" data-whatsapp><Icon name="message-circle" small /> WhatsApp</a>
      </div>
    </template>
  </Sheet>
</template>

<style scoped>
.texto { margin: 12px 0 0; white-space: pre-wrap; word-break: break-word; font: inherit; font-size: 13.5px; line-height: 1.5; max-height: 46vh; overflow: auto; }
</style>
