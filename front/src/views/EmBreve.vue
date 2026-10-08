<script setup lang="ts">
import { TITULOS } from '@/layouts/menus'
import Icon from '@/components/Icon.vue'

defineProps<{ secao: string }>()
</script>

<template>
  <div class="card empty" style="display: flex; flex-direction: column; align-items: center; gap: 8px">
    <Icon name="smartphone" />
    <b style="color: var(--strong)">{{ TITULOS[secao] ?? secao }}</b>
    <span class="small">Esta tela entra nas próximas etapas.</span>
  </div>
</template>
