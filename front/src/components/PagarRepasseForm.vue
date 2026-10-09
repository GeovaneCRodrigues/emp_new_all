<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { FormaRepasse, RepasseApi, ResumoDoIndicadorApi } from '@/api/repasses'
import { repassesApi } from '@/api/recursos'
import { useApp } from '@/composables/useApp'
import { fmt } from '@/domain/format'
import DateField from './DateField.vue'
import MoneyInput from './MoneyInput.vue'
import Seg from './Seg.vue'
import Sheet from './Sheet.vue'

/** Registra um repasse (total ou parcial) ao indicador. O servidor confere que não passa do que está a pagar. */
const props = defineProps<{ aberto: boolean; item: ResumoDoIndicadorApi | null }>()
const emit = defineEmits<{ fechar: []; pago: [r: RepasseApi] }>()
const { sessao, hoje } = useApp()

const FORMAS = [{ id: 'PIX', label: 'Pix' }, { id: 'DINHEIRO', label: 'Dinheiro' }, { id: 'TRANSFERENCIA', label: 'Transferência' }]
const valor = ref(0)
const forma = ref<FormaRepasse>('PIX')
const data = ref('')
const obs = ref('')
const erro = ref('')
const enviando = ref(false)

const aPagar = computed(() => props.item?.resumo.aPagar ?? 0)
const problema = computed(() => {
  if (valor.value <= 0) return 'Informe quanto vai pagar'
  if (valor.value > aPagar.value + 0.004) return `Ele tem só ${fmt(aPagar.value)} a receber agora`
  if (!data.value) return 'Informe a data do pagamento'
  return ''
})
const restaria = computed(() => Math.max(0, Math.round((aPagar.value - valor.value) * 100) / 100))

watch(() => props.aberto, (aberto) => {
  if (!aberto) return
  valor.value = props.item?.resumo.aPagar ?? 0
  forma.value = 'PIX'; data.value = hoje.value; obs.value = ''; erro.value = ''
}, { immediate: true })

async function pagar() {
  if (!props.item || problema.value || enviando.value) return
  enviando.value = true; erro.value = ''
  try {
    const r = await repassesApi.pagar(sessao.value, props.item.indicador.id, { valor: valor.value, forma: forma.value, data: data.value, obs: obs.value.trim() || undefined })
    emit('pago', r.repasse)
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Não consegui registrar o repasse.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <Sheet :aberto="aberto" @fechar="emit('fechar')">
    <template v-if="item">
      <h3>Pagar {{ item.indicador.nome }}</h3>
      <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px" @submit.prevent="pagar">
        <div class="card pad" style="display: flex; justify-content: space-between; gap: 12px">
          <div><div class="lbl">A pagar agora</div><div class="val num" data-testid="a-pagar-form">{{ fmt(aPagar) }}</div></div>
          <div v-if="item.indicador.chavePix" style="text-align: right; min-width: 0"><div class="lbl">Chave Pix</div><div class="val" style="overflow-wrap: anywhere">{{ item.indicador.chavePix }}</div></div>
        </div>
        <div class="field">
          <label for="rpValor">Quanto vai pagar</label>
          <MoneyInput id="rpValor" v-model="valor" />
          <div class="row" style="gap: 8px; flex-wrap: wrap; margin-top: 6px">
            <button type="button" class="btn b-out b-sm" data-pagar-tudo @click="valor = aPagar">Pagar tudo</button>
            <button type="button" class="btn b-out b-sm" :disabled="aPagar <= 0" @click="valor = Math.round(aPagar * 50) / 100">Metade</button>
            <span v-if="valor > 0 && valor <= aPagar" class="small" data-testid="restaria">{{ restaria > 0 ? `Ainda ficam ${fmt(restaria)}` : 'Quita o que está liberado' }}</span>
          </div>
        </div>
        <div class="field"><label>Como pagou</label><Seg v-model="forma" :itens="FORMAS" /></div>
        <div class="field"><label for="rpData">Data do pagamento</label><DateField id="rpData" v-model="data" :max="hoje" min="2020-01-01" /></div>
        <div class="field"><label for="rpObs">Observação (opcional)</label><div class="inp"><input id="rpObs" v-model="obs" maxlength="300" placeholder="Ex.: adiantamento do mês" /></div></div>
        <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
        <div v-else-if="problema && valor > 0" class="small" style="color: var(--bad)" role="status">{{ problema }}</div>
        <button class="btn b-pri b-block" type="submit" :disabled="!!problema || enviando">{{ enviando ? 'Registrando…' : valor > 0 ? `Registrar repasse de ${fmt(valor)}` : 'Registrar repasse' }}</button>
        <div class="small">Isto só registra o que você já pagou ao indicador. O dinheiro não sai do caixa do sistema.</div>
      </form>
    </template>
  </Sheet>
</template>
