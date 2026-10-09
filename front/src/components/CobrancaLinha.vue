<script setup lang="ts">
import { computed } from 'vue'
import type { CobrancaApi } from '@/api/recebimentos'
import { useApp } from '@/composables/useApp'
import { dmy, fmt, fmt0, iniciais } from '@/domain/format'
import Icon from './Icon.vue'

/** `semReceber`: o indicador só acompanha (e cobra pelo WhatsApp); o botão Recebi é de quem dá a baixa. */
const props = defineProps<{ c: CobrancaApi; recebida?: boolean; semReceber?: boolean }>()
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
  <div class="cob" :data-cobranca="`${c.tipo === 'VENDA' ? '' : 'E'}${c.operacaoId}:${c.parcela}`">
    <span class="ini">{{ iniciais(c.cliente.nome) }}</span>
    <button class="mid" style="flex: 1; min-width: 0; text-align: left" @click="$emit('abrir', c)">
      <div class="t" style="font-weight: 600; color: var(--strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{{ c.cliente.nome }}</div>
      <div class="s" style="font-size: 12.5px; color: var(--soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
        {{ c.aparelho }} · parcela {{ c.parcela }}/{{ c.nParcelas }}<template v-if="c.vencimentoOriginal && aberta"> · remarcada (era {{ dmy(c.vencimentoOriginal) }})</template>
      </div>
      <div class="s" style="font-size: 12px; font-weight: 600">
        <span v-if="recebida" style="color: var(--ok)" data-situacao="recebida">recebido {{ c.ultimoRecebimentoEm ? dmy(c.ultimoRecebimentoEm) : '' }}</span>
        <span v-else-if="c.atrasoDias" style="color: var(--bad)" data-situacao="atrasada">venceu {{ dmy(c.vencimento) }} · {{ c.atrasoDias }} {{ c.atrasoDias === 1 ? 'dia' : 'dias' }}</span>
        <span v-else-if="venceHoje" style="color: var(--warn)" data-situacao="hoje">vence hoje</span>
        <span v-else class="num" style="color: var(--soft)" data-situacao="aberta">vence {{ dmy(c.vencimento) }}</span>
      </div>
    </button>
    <div class="valor-cob">
      <b class="num">{{ fmt(valorLinha) }}</b>
      <small v-if="parcial && !recebida" class="num">pagou {{ fmt(c.pago) }} de {{ fmt(c.valor) }}</small>
    </div>
    <div class="acts">
      <template v-if="recebida && c.ultimaTransacaoId"><button class="btn b-out b-sm" @click="$emit('recibo', c.ultimaTransacaoId)">Recibo</button></template>
      <template v-else-if="aberta">
        <a class="wa" :href="linkWhatsApp" target="_blank" rel="noopener" aria-label="Cobrar no WhatsApp"><Icon name="message-circle" small /></a>
        <button v-if="!semReceber" class="btn b-ok b-sm" @click="$emit('receber', c)">Recebi</button>
      </template>
    </div>
  </div>
</template>
