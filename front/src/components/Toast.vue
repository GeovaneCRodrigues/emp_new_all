<script setup lang="ts">
import { useToast } from '@/composables/useToast'
import Icon from './Icon.vue'

const { aviso, fechar } = useToast()

async function executar() {
  const a = aviso.value?.acao
  fechar()
  await a?.executar()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="aviso" class="toast" :class="aviso.tipo && `toast-${aviso.tipo}`" :role="aviso.tipo === 'erro' ? 'alert' : 'status'" data-testid="toast">
      <Icon v-if="aviso.tipo" :name="aviso.tipo === 'ok' ? 'check' : 'x'" small />
      <span>{{ aviso.mensagem }}</span>
      <button v-if="aviso.acao" type="button" @click="executar">{{ aviso.acao.texto }}</button>
    </div>
  </Teleport>
</template>
