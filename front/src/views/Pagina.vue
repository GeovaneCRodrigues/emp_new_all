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
import Indicadores from './admin/Indicadores.vue'
import Vender from './admin/Vender.vue'
import Equipe from './admin/Equipe.vue'
import InicioVendedor from './vendedor/Inicio.vue'
import CobradorCaixa from './cobrador/Caixa.vue'
import CobradorCarteira from './cobrador/Carteira.vue'
import CobradorHoje from './cobrador/Hoje.vue'
import CobradorPedidos from './cobrador/Pedidos.vue'
import CobradorRecebi from './cobrador/Recebi.vue'
import EmBreve from './EmBreve.vue'

const route = useRoute()
const { sessao, pronto } = useApp()

// telas já prontas, por perfil; o que não está aqui mostra "Em breve"
const TELAS: Record<string, Record<string, unknown>> = {
  ADMIN: { inicio: Inicio, cobrancas: Cobrancas, operacoes: Operacoes, estoque: Estoque, simulador: Simulador, clientes: Clientes, indicadores: Indicadores, vender: Vender, equipe: Equipe },
  COBRADOR: { hoje: CobradorHoje, carteira: CobradorCarteira, recebi: CobradorRecebi, caixa: CobradorCaixa, pedidos: CobradorPedidos },
  // o vendedor vê o estoque só com o preço de venda: a própria tela esconde custo e lucro conforme o perfil
  VENDEDOR: { inicio: InicioVendedor, simulador: Simulador, clientes: Clientes, estoque: Estoque, vender: Vender, vendas: Operacoes },
}

const secao = computed(() => (route.params.secao as string) || MENUS[sessao.value.perfil].inicio)
const tela = computed(() => TELAS[sessao.value.perfil]?.[secao.value] ?? null)
</script>

<template>
  <div v-if="!pronto" class="empty">Carregando…</div>
  <component :is="tela" v-else-if="tela" />
  <EmBreve v-else :secao="secao" />
</template>
