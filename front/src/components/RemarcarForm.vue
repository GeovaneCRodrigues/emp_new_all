<script setup lang="ts">
import { computed, ref } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { CobrancaApi } from '@/api/recebimentos'
import { recebimentosApi } from '@/api/recursos'
import { useApp } from '@/composables/useApp'
import { useToast } from '@/composables/useToast'
import { addDia } from '@/domain/datas'
import { dmy, fmt } from '@/domain/format'
import DateField from './DateField.vue'
import Sheet from './Sheet.vue'

/**
 * Editar o vencimento de uma parcela em aberto: o cliente combinou pagar em outro dia. Só o administrador.
 * A data original fica guardada (a parcela aparece como "remarcada (era 12/10)").
 */
const emit = defineEmits<{ feito: [] }>()
const { sessao, hoje } = useApp()
const { mostrar } = useToast()

const parcela = ref<CobrancaApi | null>(null)
const data = ref('')
const motivo = ref('')
const erro = ref('')
const enviando = ref(false)

function abrir(c: CobrancaApi) {
  parcela.value = c
  data.value = c.vencimento < hoje.value ? hoje.value : c.vencimento
  motivo.value = ''; erro.value = ''
}
defineExpose({ abrir })

const problema = computed(() => {
  const c = parcela.value
  if (!c) return ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.value)) return 'Escolha a nova data.'
  if (data.value < hoje.value) return 'A nova data não pode ser antes de hoje.'
  if (data.value > addDia(hoje.value, 366)) return 'A nova data não pode passar de um ano.'
  if (data.value === c.vencimento) return 'Escolha uma data diferente da atual.'
  return ''
})

async function salvar() {
  const c = parcela.value
  if (!c || problema.value || enviando.value) return
  enviando.value = true; erro.value = ''
  try {
    await recebimentosApi.remarcar(sessao.value, c.tipo, c.operacaoId, c.parcela, { vencimento: data.value, ...(motivo.value.trim() ? { motivo: motivo.value.trim() } : {}) })
    parcela.value = null
    mostrar(`Vencimento de ${c.cliente.nome.split(' ')[0]} mudou para ${dmy(data.value)}.`)
    emit('feito')
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Não consegui mudar o vencimento. Tente de novo.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <Sheet :aberto="parcela !== null" @fechar="parcela = null">
    <template v-if="parcela">
      <h3>Editar vencimento</h3>
      <div class="small" style="margin-top: 2px">{{ parcela.cliente.nome }} · {{ parcela.aparelho }} · parcela {{ parcela.parcela }}/{{ parcela.nParcelas }}</div>
      <div class="card pad" style="margin-top: 12px; background: var(--elevated)">
        <div class="lbl">Hoje vence</div>
        <div class="val num" data-testid="remarcar-atual">{{ dmy(parcela.vencimento) }} · {{ fmt(parcela.falta) }}</div>
        <div v-if="parcela.vencimentoOriginal" class="small">Data original: {{ dmy(parcela.vencimentoOriginal) }}</div>
      </div>
      <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px" novalidate @submit.prevent="salvar">
        <div class="field"><label for="rvData">Nova data de vencimento</label><DateField id="rvData" v-model="data" :min="hoje" /></div>
        <div class="field"><label for="rvMotivo">Motivo (opcional)</label><div class="inp"><input id="rvMotivo" v-model="motivo" maxlength="500" placeholder="Ex.: cliente combinou pagar dia 20" autocomplete="off" /></div></div>
        <div class="small">O valor da parcela não muda. A data de antes fica guardada e a mudança entra no histórico.</div>
        <div v-if="problema" class="small" role="status" style="color: var(--soft)" data-testid="remarcar-problema">{{ problema }}</div>
        <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
        <button class="btn b-pri b-block" type="submit" :disabled="!!problema || enviando">{{ enviando ? 'Salvando…' : 'Salvar nova data' }}</button>
      </form>
    </template>
  </Sheet>
</template>
