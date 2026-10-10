<script setup lang="ts">
import Icon from '@/components/Icon.vue'

defineProps<{ placeholder: string; rotulo?: string }>()
const modelo = defineModel<string>({ default: '' })
</script>

<template>
  <label class="busca" data-testid="campo-busca">
    <Icon name="search" small />
    <input v-model="modelo" type="search" :placeholder="placeholder" :aria-label="rotulo ?? placeholder" maxlength="80" autocomplete="off" />
    <button v-if="modelo" type="button" class="busca-limpar" aria-label="Limpar a busca" @click.prevent="modelo = ''"><Icon name="x" small /></button>
  </label>
</template>

<style scoped>
.busca-limpar { border: 0; background: none; color: var(--dim); display: grid; place-items: center; padding: 4px; cursor: pointer }
/* o "x" nativo do input de busca duplicaria o nosso */
input[type='search']::-webkit-search-cancel-button { display: none }
</style>
