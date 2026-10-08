<script setup lang="ts">
import Icon from './Icon.vue'

defineProps<{ itens: { id: string; label: string; icon: string; n?: number }[] }>()
const atual = defineModel<string>({ required: true })
</script>

<template>
  <div class="abas">
    <button v-for="i in itens" :key="i.id" :class="{ on: atual === i.id }" @click="atual = i.id">
      <Icon :name="i.icon" />{{ i.label }}<span v-if="i.n" class="n">{{ i.n }}</span>
    </button>
  </div>
</template>
