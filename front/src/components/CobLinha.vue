<script setup lang="ts">
import { computed } from 'vue'
import { useApp, type ItemCobranca } from '@/composables/useApp'
import { faltaP, pagoP } from '@/domain/calc'
import { diasEntre } from '@/domain/datas'
import { dmy, fmt, fmt0, iniciais } from '@/domain/format'
import Icon from './Icon.vue'

const props = defineProps<{ x: ItemCobranca }>()
const emit = defineEmits<{ abrir: [x: ItemCobranca] }>()
const { hoje } = useApp()

const aberta = computed(() => !props.x.p.pago)
const atraso = computed(() => (aberta.value && props.x.p.venc < hoje.value ? diasEntre(props.x.p.venc, hoje.value) : 0))
const venceHoje = computed(() => props.x.p.venc === hoje.value)
const parcial = computed(() => aberta.value && pagoP(props.x.p) > 0)
const valorLinha = computed(() => (props.x.p.pago ? pagoP(props.x.p) : faltaP(props.x.p)))
const total = computed(() => props.x.op.parcelas.length)

/** Texto do lembrete que vai pro WhatsApp do cliente. */
const linkWhatsApp = computed(() => {
  const fone = '55' + props.x.c.fone.replace(/\D/g, '')
  const primeiro = props.x.c.nome.split(' ')[0]
  const msg = atraso.value
    ? `Oi ${primeiro}, tudo bem? A parcela ${props.x.p.n}/${total.value} do seu ${props.x.item} (${fmt(faltaP(props.x.p))}) venceu dia ${dmy(props.x.p.venc)}. Consegue pagar hoje?`
    : `Oi ${primeiro}, tudo bem? Passando pra lembrar da parcela ${props.x.p.n}/${total.value} do seu ${props.x.item} (${fmt(faltaP(props.x.p))}), que vence dia ${dmy(props.x.p.venc)}.`
  return `https://wa.me/${fone}?text=${encodeURIComponent(msg)}`
})
</script>

<template>
  <div class="cob">
    <span class="ini">{{ iniciais(x.c.nome) }}</span>
    <button class="mid" style="flex: 1; min-width: 0; text-align: left" @click="emit('abrir', x)">
      <div class="t" style="font-weight: 500; color: var(--strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{{ x.c.nome }}</div>
      <div class="s" style="font-size: 12px; color: var(--soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis">
        <b class="num" style="color: var(--strong)">{{ fmt(valorLinha) }}</b>
        <span v-if="parcial" style="color: var(--warn); font-weight: 600"> resta</span> ·
        <span v-if="x.p.pago" style="color: var(--ok); font-weight: 600">pago {{ dmy(x.p.pago) }}{{ x.p.desconto ? ' com desconto' : '' }}</span>
        <span v-else-if="atraso" style="color: var(--bad); font-weight: 600">{{ atraso }} {{ atraso === 1 ? 'dia' : 'dias' }}</span>
        <span v-else-if="venceHoje" style="color: var(--warn); font-weight: 600">vence hoje</span>
        <span v-else class="num">vence {{ dmy(x.p.venc) }}</span>
      </div>
      <div class="s" style="font-size: 12px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis">
        {{ x.item }} · parcela {{ x.p.n }}/{{ total }}<template v-if="parcial"> · já pagou {{ fmt0(pagoP(x.p)) }}</template><template v-if="x.p.vencOriginal && !x.p.pago"> · remarcada (era {{ dmy(x.p.vencOriginal) }})</template>
      </div>
    </button>
    <div class="acts">
      <a v-if="aberta" class="wa" :href="linkWhatsApp" target="_blank" rel="noopener" aria-label="Cobrar no WhatsApp"><Icon name="message-circle" small /></a>
    </div>
  </div>
</template>
