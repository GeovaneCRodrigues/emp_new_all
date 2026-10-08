<script setup lang="ts">
import { computed } from 'vue'
import { mascaraCentavos, moneyBR } from '@/domain/format'

const props = defineProps<{ id?: string }>()
const valor = defineModel<number>({ required: true })
const texto = computed(() => moneyBR(valor.value))

/** Digita pelos centavos: "400000" vira "4.000,00". */
function aoDigitar(e: Event) {
  const el = e.target as HTMLInputElement
  const m = mascaraCentavos(el.value)
  el.value = m.texto
  valor.value = m.valor
}
</script>

<template>
  <div class="inp">
    <span>R$</span>
    <input :id="props.id" inputmode="numeric" :value="texto" @input="aoDigitar" />
  </div>
</template>
