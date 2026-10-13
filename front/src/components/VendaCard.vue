<script setup lang="ts">
import { computed } from 'vue'
import type { VendaApi } from '@/api/vendas'
import { dmy, fmt0, gbTxt } from '@/domain/format'
import MiniFone from './MiniFone.vue'

const props = defineProps<{ v: VendaApi }>()
defineEmits<{ abrir: [v: VendaApi] }>()

const pct = computed(() => (props.v.total > 0 ? Math.round((props.v.recebido / props.v.total) * 100) : 100))
const chip = computed(() => {
  const v = props.v
  if (v.atrasadas) return { cls: 'c-bad', txt: `${v.atrasadas} atrasada${v.atrasadas > 1 ? 's' : ''}` }
  if (v.status === 'QUITADA') return { cls: 'c-ok', txt: 'quitada' }
  if (v.status === 'RETOMADA') return { cls: 'c-neu', txt: 'retomada' }
  if (v.contrato === 'AGUARDANDO') return { cls: 'c-warn', txt: 'contrato pendente' }
  return { cls: 'c-pri', txt: 'em dia' }
})
const resumo = computed(() => `${props.v.aparelho.modelo} ${gbTxt(props.v.aparelho.gb)} · ${props.v.nParcelas ? `${props.v.nParcelas}x ${fmt0(props.v.valorParcela)}` : 'à vista'}`)
</script>

<template>
  <button class="card pad" style="text-align: left; display: flex; flex-direction: column; gap: 10px" @click="$emit('abrir', v)">
    <div class="row">
      <MiniFone :cor="v.aparelho.cor" />
      <div style="flex: 1; min-width: 0">
        <div class="between"><span class="val" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{{ v.cliente.nome }}</span><span class="chip" :class="chip.cls">{{ chip.txt }}</span></div>
        <div class="small">{{ resumo }}</div>
      </div>
    </div>
    <div>
      <div class="between small"><span><b class="num" style="color: var(--strong)">{{ fmt0(v.recebido) }}</b> de {{ fmt0(v.total) }}</span><span class="num">{{ pct }}%</span></div>
      <div class="bar" style="margin-top: 5px"><i :style="{ width: pct + '%', background: v.atrasadas ? 'var(--bad)' : 'var(--primary)' }"></i></div>
    </div>
    <div class="between small">
      <span>{{ dmy(v.dataVenda) }} · {{ v.indicador?.nome ?? 'venda direta' }}</span>
      <span v-if="v.seuLucro !== undefined">seu lucro <b class="num" style="color: var(--ok)">{{ fmt0(v.seuLucro) }}</b></span>
    </div>
  </button>
</template>
