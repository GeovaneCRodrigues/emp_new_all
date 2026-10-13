<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Icon from './Icon.vue'

const props = defineProps<{ aberto: boolean }>()
const emit = defineEmits<{ fechar: [] }>()

// Folhas empilhadas (a ficha da venda com o recebimento por cima): o Esc fecha só a de cima.
const pilha: symbol[] = ((globalThis as { __pilhaFolhas?: symbol[] }).__pilhaFolhas ??= [])
const meu = Symbol('folha')
const dialogo = ref<HTMLElement | null>(null)
/** Quem tinha o foco antes de abrir (o card tocado): volta para ele ao fechar. */
let quemTinhaFoco: HTMLElement | null = null
const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape' && pilha[pilha.length - 1] === meu) emit('fechar') }
function abrir() {
  if (!pilha.includes(meu)) pilha.push(meu)
  document.addEventListener('keydown', aoTeclar)
  quemTinhaFoco = document.activeElement instanceof HTMLElement ? document.activeElement : null
  // leva o foco para a folha: quem usa o teclado ou leitor de tela percebe que ela abriu
  nextTick(() => { if (dialogo.value && !dialogo.value.contains(document.activeElement)) dialogo.value.focus({ preventScroll: true }) }) // não tira o foco de um campo que já o pegou
}
function fechar() {
  const i = pilha.indexOf(meu)
  if (i >= 0) pilha.splice(i, 1)
  document.removeEventListener('keydown', aoTeclar)
  if (quemTinhaFoco?.isConnected) quemTinhaFoco.focus({ preventScroll: true })
  quemTinhaFoco = null
}
watch(() => props.aberto, (aberto) => (aberto ? abrir() : fechar()), { immediate: true })
onBeforeUnmount(fechar)
</script>

<template>
  <Teleport to="body">
    <div v-if="aberto" class="ov" @click.self="emit('fechar')">
      <div class="sheet-w">
        <button class="xfechar" type="button" aria-label="Fechar" title="Fechar (Esc)" @click="emit('fechar')"><Icon name="x" /></button>
        <div ref="dialogo" class="sheet" role="dialog" aria-modal="true" tabindex="-1" style="outline: none">
          <div class="grab"></div>
          <slot />
        </div>
      </div>
    </div>
  </Teleport>
</template>
