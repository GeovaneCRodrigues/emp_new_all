<script setup lang="ts">
import { computed } from 'vue'

/**
 * Rodapé das listas que carregam tudo sozinhas (sem botão "Carregar mais"): enquanto o resto chega mostra o andamento,
 * e se terminou e ainda falta (trava de segurança de 3.000 itens) avisa para usar a busca. `parado`: deu erro (o aviso de erro já está na tela).
 */
const props = defineProps<{ mostrados: number; total: number; carregando: boolean; parado?: boolean }>()
const faltam = computed(() => props.mostrados < props.total)
</script>

<template>
  <div v-if="faltam && carregando && !parado" class="small" style="text-align: center; padding: 8px" role="status" data-testid="lista-carregando">Carregando o restante… {{ mostrados }} de {{ total }}</div>
  <div v-else-if="faltam && !carregando && !parado" class="aviso" role="status" data-testid="lista-cortada">Mostrando os primeiros {{ mostrados }} de {{ total }}. Use a busca para achar o resto.</div>
</template>
