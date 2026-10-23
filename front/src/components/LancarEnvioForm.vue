<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import { contaIndicadorApi } from '@/api/recursos'
import type { ContaIndicadorApi } from '@/api/contaIndicador'
import { useApp } from '@/composables/useApp'
import { useToast } from '@/composables/useToast'
import { fmt } from '@/domain/format'
import DateField from './DateField.vue'
import MoneyInput from './MoneyInput.vue'
import Seg from './Seg.vue'
import Sheet from './Sheet.vue'

/** O administrador lança o que o indicador enviou à loja: baixa o saldo dele e entra no Caixa na data. */
const props = defineProps<{ aberto: boolean; indicador: { id: number; nome: string } | null; saldo: number }>()
const emit = defineEmits<{ fechar: []; feito: [conta: ContaIndicadorApi] }>()
const { sessao, hoje } = useApp()
const { mostrar } = useToast()

const LADOS = [{ id: 'EMPRESTIMO', label: 'Empréstimos' }, { id: 'IPHONE', label: 'iPhones' }]
const f = reactive({ valor: 0, data: '', comprovante: '', lado: 'EMPRESTIMO' as 'EMPRESTIMO' | 'IPHONE' })
const erro = ref('')
const enviando = ref(false)

watch(() => props.aberto, (a) => { if (a) { Object.assign(f, { valor: 0, data: hoje.value, comprovante: '', lado: 'EMPRESTIMO' }); erro.value = '' } })

/** Mandou mais do que devia: vira crédito dele (a loja passa a dever). Deixa lançar, só avisa. */
const aviso = computed(() => (f.valor > 0 && f.valor > props.saldo + 0.004 ? `Isso passa do que ele devia (${fmt(Math.max(props.saldo, 0))}): o que sobrar vira crédito dele com a loja.` : ''))
const problema = computed(() => (f.valor > 0 ? '' : 'Informe quanto ele enviou.'))

async function confirmar() {
  if (enviando.value || problema.value || !props.indicador) return
  enviando.value = true; erro.value = ''
  try {
    const conta = await contaIndicadorApi.lancarEnvio(sessao.value, props.indicador.id, {
      valor: f.valor, data: f.data || hoje.value, lado: f.lado, ...(f.comprovante.trim() ? { comprovante: f.comprovante.trim() } : {}),
    })
    mostrar(`Envio de ${fmt(f.valor)} lançado.`)
    emit('feito', conta)
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Não consegui lançar o envio. Tente de novo.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <Sheet :aberto="aberto" @fechar="emit('fechar')">
    <template v-if="indicador">
      <h3>Lançar envio</h3>
      <div class="small">{{ indicador.nome }} enviou dinheiro para a loja</div>
      <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px" novalidate @submit.prevent="confirmar">
        <div class="field"><label for="envValor">Quanto ele enviou?</label><MoneyInput id="envValor" v-model="f.valor" /></div>
        <div v-if="aviso" class="aviso" role="status" data-testid="envio-aviso">{{ aviso }}</div>
        <div class="field"><label for="envData">Quando chegou?</label><DateField id="envData" v-model="f.data" :max="hoje" min="2020-01-01" /></div>
        <div class="field"><label>Entra em qual caixa?</label><Seg v-model="f.lado" :itens="LADOS" /></div>
        <div class="field"><label for="envComprovante">Comprovante (opcional)</label><div class="inp"><input id="envComprovante" v-model="f.comprovante" maxlength="120" placeholder="Ex.: ID da transação Pix" autocomplete="off" /></div></div>
        <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
        <button class="btn b-pri b-block" type="submit" :disabled="enviando || !!problema">{{ enviando ? 'Lançando…' : 'Lançar envio' }}</button>
      </form>
    </template>
  </Sheet>
</template>
