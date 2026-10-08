<script setup lang="ts">
import { CORES } from '@/data/cores'
import Icon from './Icon.vue'

defineProps<{ cor?: string }>()
</script>

<template>
  <span class="mini-fone">
    <Icon name="smartphone" small />
    <span v-if="cor" class="bolinha" :style="{ background: CORES[cor] || '#999' }"></span>
  </span>
</template>

<style scoped>
.mini-fone { width: 38px; height: 38px; border-radius: 10px; background: var(--elevated); border: 1px solid var(--border); display: grid; place-items: center; position: relative; flex: none; }
.bolinha { position: absolute; bottom: 4px; right: 4px; width: 8px; height: 8px; border-radius: 50%; box-shadow: 0 0 0 1.5px var(--surface); }
</style>
