<script setup lang="ts">
import { computed } from 'vue'
import type { EmprestimoApi } from '@/api/emprestimos'
import { dmy, fmt0 } from '@/domain/format'
import Icon from './Icon.vue'

const props = defineProps<{ e: EmprestimoApi }>()
defineEmits<{ abrir: [e: EmprestimoApi] }>()

const MOD = { PARCELADO: 'Parcelado', JUROS: 'Só juros', DIARIA: 'Diária' } as const
const pct = computed(() => (props.e.total > 0 ? Math.round((props.e.recebido / props.e.total) * 100) : 100))
const chip = computed(() => {
  const e = props.e
  if (e.atrasadas) return { cls: 'c-bad', txt: `${e.atrasadas} atrasada${e.atrasadas > 1 ? 's' : ''}` }
  if (e.status === 'QUITADA') return { cls: 'c-ok', txt: 'quitado' }
  return { cls: 'c-pri', txt: 'em dia' }
})
// quem não é admin não recebe capital nem taxa
const resumo = computed(() => {
  const e = props.e
  const base = `${MOD[e.modalidade]} · ${e.nParcelas}x ${fmt0(e.valorParcela)}`
  return e.capital !== undefined ? `${base} · capital ${fmt0(e.capital)} a ${e.taxa}%${e.modalidade === 'DIARIA' ? '' : ' ao mês'}` : base
})
</script>

<template>
  <button class="card pad" style="text-align: left; display: flex; flex-direction: column; gap: 10px" :data-emprestimo="e.id" @click="$emit('abrir', e)">
    <div class="row">
      <span class="pic" style="width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--elevated)"><Icon name="landmark" /></span>
      <div style="flex: 1; min-width: 0">
        <div class="between"><span class="val" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{{ e.cliente.nome }}</span><span class="chip" :class="chip.cls">{{ chip.txt }}</span></div>
        <div class="small">{{ resumo }}</div>
      </div>
    </div>
    <div>
      <div class="between small"><span><b class="num" style="color: var(--strong)">{{ fmt0(e.recebido) }}</b> de {{ fmt0(e.total) }}</span><span class="num">{{ pct }}%</span></div>
      <div class="bar" style="margin-top: 5px"><i :style="{ width: pct + '%', background: e.atrasadas ? 'var(--bad)' : 'var(--primary)' }"></i></div>
    </div>
    <div class="between small">
      <span>{{ dmy(e.dataEmprestimo) }}<template v-if="e.indicador !== undefined"> · {{ e.indicador?.nome ?? 'sem indicador' }}</template></span>
      <span v-if="e.seuLucro !== undefined">seu lucro <b class="num" style="color: var(--ok)">{{ fmt0(e.seuLucro) }}</b></span>
    </div>
  </button>
</template>
