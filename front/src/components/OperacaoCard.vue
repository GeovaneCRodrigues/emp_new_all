<script setup lang="ts">
import { computed } from 'vue'
import { useApp } from '@/composables/useApp'
import type { Contas } from '@/domain/calc'
import { dmy, fmt0 } from '@/domain/format'
import type { Operacao } from '@/domain/types'
import Icon from './Icon.vue'
import MiniFone from './MiniFone.vue'

const props = defineProps<{ o: Operacao; k: Contas }>()
const { d, clienteDe, bemDe, pode } = useApp()

const c = computed(() => clienteDe(props.o.clienteId))
const pct = computed(() => Math.round((props.k.recebido / props.k.total) * 100))
const atrasada = computed(() => props.k.atrasadas.length > 0)
const bem = computed(() => (props.o.tipo === 'VENDA' ? bemDe(props.o.bemId) : null))
const indicador = computed(() => d.value?.indicadores.find((i) => i.id === props.o.indicadorId)?.nome)
const MOD = { PARCELADO: 'Parcelado', JUROS: 'Só juros', DIARIA: 'Diária' } as const

const resumo = computed(() => {
  const o = props.o
  const n = o.parcelas.length
  const v = fmt0(o.parcelas[0].valor)
  return o.tipo === 'EMP'
    ? `${MOD[o.mod]} · ${fmt0(o.capital)} a ${o.taxa}%${o.mod === 'DIARIA' ? '' : ' ao mês'} · ${n}x ${v}`
    : `${bem.value!.modelo} ${bem.value!.gb} GB · ${n}x ${v}`
})
const chip = computed(() => {
  if (atrasada.value) return { cls: 'c-bad', txt: `${props.k.atrasadas.length} atrasada${props.k.atrasadas.length > 1 ? 's' : ''}` }
  if (props.k.status === 'QUITADA') return { cls: 'c-ok', txt: props.o.tipo === 'EMP' ? 'quitado' : 'quitada' }
  if (props.o.tipo === 'VENDA' && props.o.contrato === 'AGUARDANDO') return { cls: 'c-warn', txt: 'contrato pendente' }
  return { cls: 'c-pri', txt: 'em dia' }
})
</script>

<template>
  <button class="card pad" style="text-align: left; display: flex; flex-direction: column; gap: 10px">
    <div class="row">
      <MiniFone v-if="bem" :cor="bem.cor" />
      <span v-else class="pic-emp"><Icon :name="o.tipo === 'EMP' && o.mod === 'DIARIA' ? 'calendar-range' : 'landmark'" small /></span>
      <div style="flex: 1; min-width: 0">
        <div class="between">
          <span class="val" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{{ c.nome }}</span>
          <span class="chip" :class="chip.cls">{{ chip.txt }}</span>
        </div>
        <div class="small">{{ resumo }}</div>
      </div>
    </div>
    <div>
      <div class="between small">
        <span><b class="num" style="color: var(--strong)">{{ fmt0(k.recebido) }}</b> de {{ fmt0(k.total) }}</span><span class="num">{{ pct }}%</span>
      </div>
      <div class="bar" style="margin-top: 5px"><i :style="{ width: pct + '%', background: atrasada ? 'var(--bad)' : 'var(--primary)' }"></i></div>
    </div>
    <div class="between small">
      <span>{{ o.tipo === 'EMP' ? 'liberado' : '' }} {{ dmy(o.data) }} · {{ indicador ?? (o.tipo === 'EMP' ? 'direto' : 'venda direta') }}</span>
      <span v-if="pode.verCustoELucro">seu lucro <b class="num" style="color: var(--ok)">{{ fmt0(k.seuLucro) }}</b></span>
    </div>
  </button>
</template>

<style scoped>
.pic-emp { width: 38px; height: 38px; border-radius: 10px; background: var(--gold-soft); color: var(--warn); display: grid; place-items: center; flex: none; }
</style>
