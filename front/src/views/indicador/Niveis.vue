<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { IndicadorApi, TabelaNiveis } from '@/api/indicadores'
import { indicadoresApi } from '@/api/recursos'
import Icon from '@/components/Icon.vue'
import { COR_NIVEL } from '@/data/niveis'
import { useApp } from '@/composables/useApp'

/** Os níveis: quanto mais o indicador indica, maior o % dele nas próximas operações. */
const { sessao } = useApp()
const eu = ref<IndicadorApi | null>(null)
const tabela = ref<TabelaNiveis | null>(null)
const erro = ref('')

onMounted(async () => {
  try {
    ;[eu.value, tabela.value] = await Promise.all([indicadoresApi.obter(sessao.value, sessao.value.indicadorId ?? -1), indicadoresApi.niveis(sessao.value)])
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar os níveis.'
  }
})
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`
const passos = computed(() => (tabela.value?.niveis ?? []).map((n) => ({
  ...n,
  estado: eu.value && n.id === eu.value.nivel.id ? 'atual' : eu.value && n.minOperacoes < eu.value.nivel.minOperacoes ? 'conquistado' : 'falta',
})))
</script>

<template>
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
  <template v-if="eu && tabela">
    <p class="small" style="margin: 0">Você tem {{ eu.operacoes }} {{ eu.operacoes === 1 ? 'operação indicada' : 'operações indicadas' }}. Quanto mais indica, maior o seu % nas próximas.</p>
    <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 14px" data-testid="niveis">
      <div v-for="n in passos" :key="n.id" class="nivel-passo" :style="n.estado === 'atual' ? { background: COR_NIVEL[n.id]?.fundo, borderColor: COR_NIVEL[n.id]?.cor } : {}" :data-nivel="n.id" :data-estado="n.estado">
        <span class="bola" :style="{ background: n.estado === 'falta' ? 'transparent' : COR_NIVEL[n.id]?.cor, borderColor: n.estado === 'falta' ? 'var(--border)' : COR_NIVEL[n.id]?.cor }"><Icon v-if="n.estado !== 'falta'" name="check" small /></span>
        <div style="flex: 1; min-width: 0"><div class="val" :style="{ color: COR_NIVEL[n.id]?.cor }">{{ n.nome }} · {{ pct(n.pct) }} do lucro</div><div class="small">{{ n.minOperacoes === 0 ? 'começo' : `a partir de ${n.minOperacoes} operações` }}</div></div>
        <span class="small" style="font-weight: 600">{{ n.estado === 'atual' ? 'você está aqui' : n.estado === 'conquistado' ? 'conquistado' : `faltam ${Math.max(0, n.minOperacoes - eu.operacoes)}` }}</span>
      </div>
    </div>
    <div class="small" style="margin-top: 12px">Seu % de agora: <b>{{ pct(eu.pct) }}</b>. {{ eu.pctManual ? 'A loja definiu o seu % à mão.' : 'Ele acompanha o seu nível.' }} O % de cada operação fica fixo na hora em que ela é feita.</div>
  </template>
</template>
