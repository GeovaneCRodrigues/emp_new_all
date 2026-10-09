<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CobrancaApi } from '@/api/recebimentos'
import { ErroApi } from '@/api/clientes'
import { aprovacoesApi } from '@/api/recursos'
import { useApp } from '@/composables/useApp'
import { useToast } from '@/composables/useToast'
import { dmy, fmt } from '@/domain/format'
import DateField from './DateField.vue'
import MoneyInput from './MoneyInput.vue'
import Seg from './Seg.vue'
import Sheet from './Sheet.vue'

/**
 * O "Recebi" do indicador: ele AVISA a loja que recebeu uma parcela. Isto não dá baixa: a parcela fica "esperando a loja"
 * até o administrador confirmar (aí vira recebimento e o recibo sai) ou recusar (aí a parcela volta a ficar em aberto).
 */
const emit = defineEmits<{ enviado: [] }>()
const { sessao, hoje } = useApp()
const { mostrar } = useToast()

const FORMAS = [{ id: 'PIX', label: 'Pix' }, { id: 'DINHEIRO', label: 'Dinheiro' }, { id: 'CARTAO', label: 'Cartão' }]
const parcela = ref<CobrancaApi | null>(null)
const valor = ref(0)
const forma = ref<'PIX' | 'DINHEIRO' | 'CARTAO'>('PIX')
const data = ref('')
const comprovante = ref('')
const obs = ref('')
const erro = ref('')
const enviando = ref(false)

function abrir(c: CobrancaApi) {
  parcela.value = c
  valor.value = c.falta; forma.value = 'PIX'; data.value = hoje.value; comprovante.value = ''; obs.value = ''; erro.value = ''
}
defineExpose({ abrir })

const problema = computed(() => {
  const c = parcela.value
  if (!c) return ''
  if (valor.value <= 0) return 'Informe quanto você recebeu'
  if (valor.value > c.falta + 0.009) return `Esta parcela só tem ${fmt(c.falta)} em aberto`
  if (!data.value) return 'Informe a data em que recebeu'
  return ''
})
const menos = computed(() => !!parcela.value && valor.value > 0 && valor.value < parcela.value.falta - 0.009)

async function enviar() {
  const c = parcela.value
  if (!c || problema.value || enviando.value) return
  enviando.value = true; erro.value = ''
  try {
    await aprovacoesApi.pedirBaixa(sessao.value, {
      alvo: c.tipo, operacaoId: c.operacaoId, parcela: c.parcela, valor: valor.value, forma: forma.value, data: data.value,
      ...(comprovante.value.trim() ? { comprovante: comprovante.value.trim() } : {}), ...(obs.value.trim() ? { motivo: obs.value.trim() } : {}),
    })
    parcela.value = null
    mostrar(`Aviso enviado. A loja confirma o recebimento de ${c.cliente.nome.split(' ')[0]}.`)
    emit('enviado')
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Não consegui avisar a loja. Tente de novo.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <Sheet :aberto="parcela !== null" @fechar="parcela = null">
    <template v-if="parcela">
      <h3>Avisar a loja que recebi</h3>
      <div class="small" style="margin-top: 2px">{{ parcela.cliente.nome }} · {{ parcela.aparelho }} · parcela {{ parcela.parcela }}/{{ parcela.nParcelas }} · vence {{ dmy(parcela.vencimento) }}</div>
      <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px" novalidate @submit.prevent="enviar">
        <div class="aviso">Isto não dá baixa sozinho: a parcela fica “esperando a loja” até ela confirmar.</div>
        <div class="field">
          <label for="avValor">Quanto você recebeu?</label>
          <MoneyInput id="avValor" v-model="valor" />
          <div class="small">Em aberto na parcela: <b class="num">{{ fmt(parcela.falta) }}</b></div>
        </div>
        <div v-if="menos" class="small" style="color: var(--warn)" data-testid="menos">É menos que a parcela: a loja decide se o resto fica devendo ou vira desconto.</div>
        <div class="field"><label>Como recebeu</label><Seg v-model="forma" :itens="FORMAS" /></div>
        <div class="field"><label for="avData">Quando recebeu</label><DateField id="avData" v-model="data" :max="hoje" min="2020-01-01" /></div>
        <div class="field"><label for="avComp">Código do comprovante (opcional)</label><div class="inp"><input id="avComp" v-model="comprovante" maxlength="120" placeholder="Ex.: ID da transação Pix" autocomplete="off" /></div></div>
        <div class="field"><label for="avObs">Observação (opcional)</label><div class="inp"><input id="avObs" v-model="obs" maxlength="500" placeholder="Ex.: paguei na mão dele" autocomplete="off" /></div></div>
        <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
        <div v-else-if="problema && valor > 0" class="small" style="color: var(--bad)" role="status">{{ problema }}</div>
        <button class="btn b-pri b-block" type="submit" :disabled="!!problema || enviando">{{ enviando ? 'Enviando…' : 'Avisar a loja que recebi' }}</button>
      </form>
    </template>
  </Sheet>
</template>
