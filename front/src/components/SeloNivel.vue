<script setup lang="ts">
import { COR_NIVEL } from '@/data/niveis'
import Icon from './Icon.vue'

defineProps<{ id: string; nome: string; grande?: boolean }>()
</script>

<template>
  <span class="selo" :class="{ g: grande }" :style="{ color: COR_NIVEL[id]?.cor, background: COR_NIVEL[id]?.fundo }"><Icon name="award" small />{{ nome }}</span>
</template>
