<script setup lang="ts">
import { useToast } from '@/composables/useToast'

const { aviso, fechar } = useToast()

async function executar() {
  const a = aviso.value?.acao
  fechar()
  await a?.executar()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="aviso" class="toast" role="status" data-testid="toast">
      <span>{{ aviso.mensagem }}</span>
      <button v-if="aviso.acao" type="button" @click="executar">{{ aviso.acao.texto }}</button>
    </div>
  </Teleport>
</template>
