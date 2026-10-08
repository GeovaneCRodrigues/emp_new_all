<script setup lang="ts">
import { computed, ref } from 'vue'
import Abas from '@/components/Abas.vue'
import OperacaoCard from '@/components/OperacaoCard.vue'
import Seg from '@/components/Seg.vue'
import { useApp } from '@/composables/useApp'
import { fmt0 } from '@/domain/format'
import type { Operacao } from '@/domain/types'

const { d, contas } = useApp()

const aba = ref<'iphone' | 'emp'>('iphone')
const filtro = ref('ATIVA')

const todas = computed(() => (aba.value === 'iphone' ? d.value?.vendas : d.value?.emprestimos) ?? [])
const comContas = computed(() => todas.value.map((o: Operacao) => ({ o, k: contas(o) })))
const ativas = computed(() => comContas.value.filter(({ k }) => k.status === 'ATIVA'))
const lista = computed(() =>
  comContas.value
    .filter(({ k }) => (filtro.value === 'ATRASO' ? k.status === 'ATIVA' && k.atrasadas.length : k.status === filtro.value))
    .sort((a, b) => b.o.data.localeCompare(a.o.data)),
)

// os mesmos 3 números nas duas abas
const aReceber = computed(() => ativas.value.reduce((s, { k }) => s + k.falta, 0))
const capitalNaRua = computed(() => ativas.value.reduce((s, { k }) => s + (k.inv - k.capitalDeVolta), 0))
const lucroPorVir = computed(() => ativas.value.reduce((s, { k }) => s + Math.max(0, k.seuLucro - k.lucroRealizado), 0))

const nAtivas = (tipo: 'VENDA' | 'EMP') => [...(tipo === 'VENDA' ? d.value?.vendas : d.value?.emprestimos) ?? []].filter((o) => contas(o).status === 'ATIVA').length
const abas = computed(() => [
  { id: 'iphone', label: 'iPhones', icon: 'smartphone', n: nAtivas('VENDA') },
  { id: 'emp', label: 'Empréstimos', icon: 'landmark', n: nAtivas('EMP') },
])
const filtros = computed(() => {
  const comAtraso = ativas.value.filter(({ k }) => k.atrasadas.length).length
  return aba.value === 'iphone'
    ? [{ id: 'ATIVA', label: 'Em andamento' }, { id: 'ATRASO', label: 'Com atraso' }, { id: 'QUITADA', label: 'Quitadas' }, { id: 'RETOMADA', label: 'Retomadas' }]
    : [{ id: 'ATIVA', label: 'Em andamento' }, { id: 'ATRASO', label: `Com atraso · ${comAtraso}` }, { id: 'QUITADA', label: 'Quitados' }]
})
</script>

<template>
  <Abas v-model="aba" :itens="abas" />
  <div class="resumo3">
    <div><div class="lbl">A receber</div><div class="val num">{{ fmt0(aReceber) }}</div></div>
    <div><div class="lbl">Capital na rua</div><div class="val num">{{ fmt0(capitalNaRua) }}</div></div>
    <div><div class="lbl">Lucro por vir</div><div class="val num" style="color: var(--ok)">{{ fmt0(lucroPorVir) }}</div></div>
  </div>
  <Seg v-model="filtro" :itens="filtros" />
  <div class="fones">
    <OperacaoCard v-for="{ o, k } in lista" :key="o.id" :o="o" :k="k" />
    <div v-if="!lista.length" class="card empty">{{ aba === 'iphone' ? 'Nenhuma venda aqui.' : 'Nenhum empréstimo aqui.' }}</div>
  </div>
</template>
