<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Seg from '@/components/Seg.vue'
import { CORES } from '@/data/cores'
import { useApp } from '@/composables/useApp'
import { investido } from '@/domain/calc'
import { diasEntre } from '@/domain/datas'
import { fmt0 } from '@/domain/format'

const router = useRouter()
const { d, hoje, pode, clienteDe } = useApp()

const filtro = ref('DISPONIVEL')
const busca = ref('')

const bens = computed(() => d.value?.bens ?? [])
const disp = computed(() => bens.value.filter((b) => b.estado === 'DISPONIVEL'))
const enc = computed(() => bens.value.filter((b) => b.estado === 'ENCOMENDADO'))
const margem = computed(() => (disp.value.length ? disp.value.reduce((s, b) => s + (b.preco - investido(b)) / b.preco, 0) / disp.value.length : 0))
const lista = computed(() => {
  const q = busca.value.trim().toLowerCase()
  return bens.value.filter((b) => b.estado === filtro.value).filter((b) => !q || `${b.modelo} ${b.gb} ${b.cor} ${b.imei}`.toLowerCase().includes(q))
})
const filtros = computed(() => [
  { id: 'DISPONIVEL', label: `Disponível · ${disp.value.length}` },
  { id: 'ENCOMENDADO', label: `Encomendado · ${enc.value.length}` },
  { id: 'VENDIDO', label: 'Vendidos' },
])
const corBateria = (n: number) => (n >= 90 ? 'var(--ok)' : n >= 85 ? 'var(--soft)' : 'var(--warn)')
</script>

<template>
  <div class="resumo3">
    <div><div class="lbl">Disponível</div><div class="val num">{{ disp.length }} aparelhos</div></div>
    <template v-if="pode.verCustoELucro">
      <div><div class="lbl">Capital parado</div><div class="val num">{{ fmt0(disp.reduce((s, b) => s + investido(b), 0)) }}</div></div>
      <div><div class="lbl">Margem média</div><div class="val num" style="color: var(--ok)">{{ Math.round(margem * 100) }}%</div></div>
    </template>
    <template v-else>
      <div><div class="lbl">Encomendados</div><div class="val num">{{ enc.length }}</div></div>
      <div><div class="lbl">Valor em vitrine</div><div class="val num">{{ fmt0(disp.reduce((s, b) => s + b.preco, 0)) }}</div></div>
    </template>
  </div>

  <label class="busca"><Icon name="search" small /><input v-model="busca" placeholder="Modelo, cor ou IMEI" /></label>
  <Seg v-model="filtro" :itens="filtros" />

  <div class="fones">
    <button v-for="b in lista" :key="b.id" class="card fone" @click="router.push('/simulador?bem=' + b.id)">
      <span class="pic"><Icon name="smartphone" /><span class="cor" :style="{ background: CORES[b.cor] || '#999' }"></span></span>
      <span class="info">
        <span class="nome">
          <span>{{ b.modelo }} · {{ b.gb }} GB</span>
          <span v-if="b.estado === 'DISPONIVEL'" class="chip" :class="diasEntre(b.desde, hoje) > 30 ? 'c-warn' : 'c-neu'">{{ diasEntre(b.desde, hoje) }}d</span>
          <span v-else-if="b.estado === 'ENCOMENDADO'" class="chip c-gold">encomenda</span>
          <span v-else class="chip c-neu">vendido</span>
        </span>
        <span class="specs">
          <span>{{ b.cor }}</span><span>{{ b.cond }}</span>
          <span :style="{ color: corBateria(b.bateria) }"><Icon name="battery-medium" small />{{ b.bateria }}%</span>
          <span v-if="b.origem === 'TROCA'">veio de troca</span>
          <span v-if="b.imei" class="mono">•••{{ b.imei.slice(-4) }}</span>
        </span>
        <span v-if="b.estado === 'ENCOMENDADO' && b.paraCliente" class="small">Para {{ clienteDe(b.paraCliente)?.nome }}</span>
        <span class="precos">
          <b class="num" style="color: var(--strong); font-size: 16px">{{ fmt0(b.preco) }}</b>
          <span v-if="pode.verCustoELucro" class="small num">custo {{ fmt0(investido(b)) }} · <span style="color: var(--ok); font-weight: 600">lucro {{ fmt0(b.preco - investido(b)) }}</span></span>
        </span>
      </span>
    </button>
    <div v-if="!lista.length" class="card empty">Nada por aqui.</div>
  </div>
</template>
