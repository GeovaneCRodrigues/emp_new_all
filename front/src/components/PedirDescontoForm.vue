<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { AlvoApi } from '@/api/recebimentos'
import { aprovacoesApi } from '@/api/recursos'
import { useApp } from '@/composables/useApp'
import { useToast } from '@/composables/useToast'
import { arred2, dmy, fmt } from '@/domain/format'
import MoneyInput from './MoneyInput.vue'
import Sheet from './Sheet.vue'

/** O cobrador pede desconto de uma parcela; a parcela só muda quando o administrador aprova. */
const props = defineProps<{ aberto: boolean; alvo: AlvoApi; operacao: { id: number; cliente: string; descricao: string } | null; parcela: { numero: number; falta: number; vencimento: string } | null }>()
const emit = defineEmits<{ fechar: []; feito: [] }>()
const { sessao } = useApp()
const { mostrar } = useToast()

const f = reactive({ valor: 0, motivo: '' })
const erro = ref('')
const enviando = ref(false)
watch(() => props.aberto, (a) => { if (a && props.parcela) { f.valor = props.parcela.falta; f.motivo = ''; erro.value = '' } })

const problema = computed(() => {
  if (!props.parcela) return ''
  if (!(f.valor > 0)) return 'Informe o valor do desconto.'
  if (f.valor > props.parcela.falta + 0.009) return `O desconto não pode passar do que falta na parcela (${fmt(props.parcela.falta)}).`
  if (f.motivo.trim().length < 3 || f.motivo.trim().length > 500) return 'Explique o motivo do pedido (de 3 a 500 letras).'
  return ''
})

async function confirmar() {
  if (enviando.value || problema.value || !props.operacao || !props.parcela) return
  enviando.value = true; erro.value = ''
  try {
    await aprovacoesApi.pedirDesconto(sessao.value, { alvo: props.alvo, operacaoId: props.operacao.id, parcela: props.parcela.numero, valor: arred2(f.valor), motivo: f.motivo.trim() })
    mostrar('Pedido de desconto enviado. O administrador vai responder.')
    emit('feito')
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <Sheet :aberto="aberto" @fechar="emit('fechar')">
    <template v-if="operacao && parcela">
      <h3>Pedir desconto</h3>
      <div class="small">{{ operacao.cliente }} · {{ operacao.descricao }} · parcela {{ parcela.numero }} (vence {{ dmy(parcela.vencimento) }})</div>
      <div class="card pad" style="margin-top: 12px; background: var(--elevated)"><div class="lbl">Falta nesta parcela</div><div class="val num">{{ fmt(parcela.falta) }}</div></div>
      <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px" novalidate @submit.prevent="confirmar">
        <div class="field"><label for="dValor">Quanto de desconto?</label><MoneyInput id="dValor" v-model="f.valor" /></div>
        <div class="field"><label for="dMotivo">Por que pedir o desconto?</label><div class="inp"><input id="dMotivo" v-model="f.motivo" maxlength="500" placeholder="Ex.: cliente só tinha esse valor" /></div></div>
        <div class="small">A parcela continua como está até o administrador aprovar.</div>
        <div v-if="problema" class="small" role="status" style="color: var(--soft)" data-testid="problema-desconto">{{ problema }}</div>
        <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
        <button class="btn b-pri b-block" type="submit" :disabled="enviando || !!problema">{{ enviando ? 'Enviando…' : 'Pedir desconto' }}</button>
      </form>
    </template>
  </Sheet>
</template>
