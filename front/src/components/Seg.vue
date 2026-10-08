<script setup lang="ts">
defineProps<{ itens: { id: string; label: string }[] }>()
const atual = defineModel<string>({ required: true })
</script>

<template>
  <div class="filtros">
    <span class="seg"><button v-for="i in itens" :key="i.id" :class="{ on: atual === i.id }" @click="atual = i.id">{{ i.label }}</button></span>
  </div>
</template>
