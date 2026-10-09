<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import Icon from './Icon.vue'

const props = defineProps<{ aberto: boolean }>()
const emit = defineEmits<{ fechar: [] }>()

// Folhas empilhadas (a ficha da venda com o recebimento por cima): o Esc fecha só a de cima.
const pilha: symbol[] = ((globalThis as { __pilhaFolhas?: symbol[] }).__pilhaFolhas ??= [])
const meu = Symbol('folha')
const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape' && pilha[pilha.length - 1] === meu) emit('fechar') }
function abrir() { if (!pilha.includes(meu)) pilha.push(meu); document.addEventListener('keydown', aoTeclar) }
function fechar() { const i = pilha.indexOf(meu); if (i >= 0) pilha.splice(i, 1); document.removeEventListener('keydown', aoTeclar) }
watch(() => props.aberto, (aberto) => (aberto ? abrir() : fechar()), { immediate: true })
onBeforeUnmount(fechar)
</script>

<template>
  <Teleport to="body">
    <div v-if="aberto" class="ov" @click.self="emit('fechar')">
      <div class="sheet-w">
        <button class="xfechar" type="button" aria-label="Fechar" title="Fechar (Esc)" @click="emit('fechar')"><Icon name="x" /></button>
        <div class="sheet" role="dialog" aria-modal="true">
          <div class="grab"></div>
          <slot />
        </div>
      </div>
    </div>
  </Teleport>
</template>
