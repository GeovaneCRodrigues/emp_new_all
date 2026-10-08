<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ReciboApi } from '@/api/recebimentos'
import { dmyA, fmt } from '@/domain/format'
import Icon from './Icon.vue'
import Sheet from './Sheet.vue'

const props = defineProps<{ recibo: ReciboApi | null }>()
defineEmits<{ fechar: [] }>()

const copiado = ref(false)
const primeiroNome = computed(() => props.recibo?.cliente.nome.split(' ')[0] ?? '')
const linkWhatsApp = computed(() => {
  const r = props.recibo
  if (!r) return '#'
  const fone = r.cliente.fone.replace(/\D/g, '')
  return `https://wa.me/${fone ? '55' + fone : ''}?text=${encodeURIComponent(r.mensagem)}`
})
const NOME_FORMA = { PIX: 'Pix', DINHEIRO: 'Dinheiro', CARTAO: 'Cartão' } as const

async function copiar() {
  if (!props.recibo) return
  try { await navigator.clipboard.writeText(props.recibo.mensagem); copiado.value = true; setTimeout(() => (copiado.value = false), 2000) } catch { /* o texto está na tela */ }
}
</script>

<template>
  <Sheet :aberto="recibo !== null" @fechar="$emit('fechar')">
    <template v-if="recibo">
      <div class="between"><h3>Recibo</h3><span v-if="recibo.desfeita" class="chip c-bad">desfeito</span><span v-else class="chip c-ok"><Icon name="check" small />pago</span></div>
      <div class="recibo" data-testid="recibo">
        <div class="between" style="align-items: flex-start">
          <div><b style="color: var(--strong)">{{ recibo.empresa.nome }}</b><div v-if="recibo.empresa.cnpj" class="small">CNPJ {{ recibo.empresa.cnpj }}</div></div>
          <div style="text-align: right"><div class="lbl">Recibo nº</div><b class="mono" style="color: var(--strong)" data-testid="recibo-numero">{{ recibo.numero }}</b></div>
        </div>
        <div class="rc-valor"><div class="lbl">Valor recebido</div><div class="disp num" style="font-size: 28px; color: var(--strong)">{{ fmt(recibo.valor) }}</div></div>
        <div class="dl">
          <div><div class="lbl">Cliente</div><div class="val">{{ recibo.cliente.nome }}</div></div>
          <div><div class="lbl">Referente a</div><div class="val">{{ recibo.aparelho }} · {{ recibo.referencia }}</div></div>
          <div><div class="lbl">Data</div><div class="val">{{ dmyA(recibo.data) }}</div></div>
          <div><div class="lbl">Forma</div><div class="val">{{ NOME_FORMA[recibo.forma] }}</div></div>
          <div><div class="lbl">Recebido por</div><div class="val">{{ recibo.recebidoPor }}</div></div>
          <div><div class="lbl">Ainda falta</div><div class="val num">{{ fmt(recibo.faltaDepois) }}</div></div>
        </div>
        <div v-if="recibo.ficaDevendo" class="small">Na {{ recibo.ficaDevendo.numero }}ª ainda ficam {{ fmt(recibo.ficaDevendo.valor) }}, para {{ dmyA(recibo.ficaDevendo.vencimento) }}.</div>
        <div v-if="recibo.proxima" class="small">Próxima parcela: {{ recibo.proxima.numero }}ª de {{ fmt(recibo.proxima.valor) }}, vence {{ dmyA(recibo.proxima.vencimento) }}.</div>
        <div v-else class="small" style="color: var(--ok); font-weight: 600">Tudo quitado.</div>
      </div>
      <div class="lbl" style="margin: 14px 0 6px">Mensagem que vai no WhatsApp</div>
      <div class="msg" data-testid="recibo-mensagem">{{ recibo.mensagem }}</div>
      <div style="display: flex; gap: 8px; margin-top: 14px">
        <a class="btn b-ok" style="flex: 1" :href="linkWhatsApp" target="_blank" rel="noopener"><Icon name="message-circle" small />Mandar pro {{ primeiroNome }}</a>
        <button class="btn b-out" @click="copiar"><Icon name="copy" small />{{ copiado ? 'Copiado!' : 'Copiar' }}</button>
      </div>
      <div class="small" style="margin-top: 8px; text-align: center">O PDF do recibo vem numa próxima etapa.</div>
    </template>
  </Sheet>
</template>
