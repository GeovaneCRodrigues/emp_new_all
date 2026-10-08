<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'

const props = defineProps<{ aberto: boolean }>()
const emit = defineEmits<{ fechar: [] }>()

// Esc fecha a folha mais recente (a última aberta é a que está por cima)
const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); emit('fechar') } }
watch(() => props.aberto, (aberto) => {
  if (aberto) document.addEventListener('keydown', aoTeclar)
  else document.removeEventListener('keydown', aoTeclar)
}, { immediate: true })
onBeforeUnmount(() => document.removeEventListener('keydown', aoTeclar))
</script>

<template>
  <Teleport to="body">
    <div v-if="aberto" class="ov" @click.self="emit('fechar')">
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="grab"></div>
        <slot />
      </div>
    </div>
  </Teleport>
</template>
