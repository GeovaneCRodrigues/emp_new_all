<script setup lang="ts">
import { computed } from 'vue'
import type { CobrancaApi } from '@/api/recebimentos'
import { useApp } from '@/composables/useApp'
import { dmy, fmt, fmt0, iniciais } from '@/domain/format'
import Icon from './Icon.vue'

const props = defineProps<{ c: CobrancaApi; recebida?: boolean }>()
defineEmits<{ abrir: [c: CobrancaApi]; receber: [c: CobrancaApi]; recibo: [id: number] }>()
const { hoje } = useApp()

const aberta = computed(() => props.c.falta > 0.009)
const venceHoje = computed(() => props.c.vencimento === hoje.value)
const parcial = computed(() => aberta.value && props.c.pago > 0)
const valorLinha = computed(() => (props.recebida ? props.c.pago : props.c.falta))
const linkWhatsApp = computed(() => {
  const c = props.c
  const fone = c.cliente.fone.replace(/\D/g, '')
  const primeiro = c.cliente.nome.split(' ')[0]
  const msg = c.atrasoDias
    ? `Oi ${primeiro}, tudo bem? A parcela ${c.parcela}/${c.nParcelas} do seu ${c.aparelho} (${fmt(c.falta)}) venceu dia ${dmy(c.vencimento)}. Consegue pagar hoje?`
    : `Oi ${primeiro}, tudo bem? Passando pra lembrar da parcela ${c.parcela}/${c.nParcelas} do seu ${c.aparelho} (${fmt(c.falta)}), que vence dia ${dmy(c.vencimento)}.`
  return `https://wa.me/${fone ? '55' + fone : ''}?text=${encodeURIComponent(msg)}`
})
</script>

<template>
  <div class="cob" :data-cobranca="`${c.vendaId}:${c.parcela}`">
    <span class="ini">{{ iniciais(c.cliente.nome) }}</span>
    <button class="mid" style="flex: 1; min-width: 0; text-align: left" @click="$emit('abrir', c)">
      <div class="t" style="font-weight: 500; color: var(--strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{{ c.cliente.nome }}</div>
      <div class="s" style="font-size: 12px; color: var(--soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis">
        <b class="num" style="color: var(--strong)">{{ fmt(valorLinha) }}</b>
        <span v-if="parcial" style="color: var(--warn); font-weight: 600"> resta</span> ·
        <span v-if="recebida" style="color: var(--ok); font-weight: 600">recebido {{ c.ultimoRecebimentoEm ? dmy(c.ultimoRecebimentoEm) : '' }}</span>
        <span v-else-if="c.atrasoDias" style="color: var(--bad); font-weight: 600">{{ c.atrasoDias }} {{ c.atrasoDias === 1 ? 'dia' : 'dias' }}</span>
        <span v-else-if="venceHoje" style="color: var(--warn); font-weight: 600">vence hoje</span>
        <span v-else class="num">vence {{ dmy(c.vencimento) }}</span>
      </div>
      <div class="s" style="font-size: 12px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis">
        {{ c.aparelho }} · parcela {{ c.parcela }}/{{ c.nParcelas }}<template v-if="parcial"> · já pagou {{ fmt0(c.pago) }}</template><template v-if="c.vencimentoOriginal && aberta"> · remarcada (era {{ dmy(c.vencimentoOriginal) }})</template>
      </div>
    </button>
    <div class="acts">
      <template v-if="recebida && c.ultimaTransacaoId"><button class="btn b-out b-sm" @click="$emit('recibo', c.ultimaTransacaoId)">Recibo</button></template>
      <template v-else-if="aberta">
        <a class="wa" :href="linkWhatsApp" target="_blank" rel="noopener" aria-label="Cobrar no WhatsApp"><Icon name="message-circle" small /></a>
        <button class="btn b-ok b-sm" @click="$emit('receber', c)">Recebi</button>
      </template>
    </div>
  </div>
</template>
