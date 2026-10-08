<script setup lang="ts">
defineProps<{ aberto: boolean }>()
defineEmits<{ fechar: [] }>()
</script>

<template>
  <Teleport to="body">
    <div v-if="aberto" class="ov" @click.self="$emit('fechar')">
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="grab"></div>
        <slot />
      </div>
    </div>
  </Teleport>
</template>
