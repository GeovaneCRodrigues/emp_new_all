<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useApp } from '@/composables/useApp'
import { MENUS } from '@/layouts/menus'
import Inicio from './admin/Inicio.vue'
import Cobrancas from './admin/Cobrancas.vue'
import Operacoes from './admin/Operacoes.vue'
import Estoque from './admin/Estoque.vue'
import Simulador from './admin/Simulador.vue'
import Clientes from './admin/Clientes.vue'
import EmBreve from './EmBreve.vue'

const route = useRoute()
const { sessao, pronto } = useApp()

// telas já prontas, por perfil; o que não está aqui mostra "Em breve"
const TELAS: Record<string, Record<string, unknown>> = {
  ADMIN: { inicio: Inicio, cobrancas: Cobrancas, operacoes: Operacoes, estoque: Estoque, simulador: Simulador, clientes: Clientes },
  VENDEDOR: { simulador: Simulador, clientes: Clientes },
}

const secao = computed(() => (route.params.secao as string) || MENUS[sessao.value.perfil].inicio)
const tela = computed(() => TELAS[sessao.value.perfil]?.[secao.value] ?? null)
</script>

<template>
  <div v-if="!pronto" class="empty">Carregando…</div>
  <component :is="tela" v-else-if="tela" />
  <EmBreve v-else :secao="secao" />
</template>
