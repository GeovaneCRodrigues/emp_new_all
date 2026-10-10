<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { LancamentoApi, TipoLancamento } from '@/api/caixa'
import { caixaApi } from '@/api/recursos'
import { useApp } from '@/composables/useApp'
import { fmt } from '@/domain/format'
import DateField from './DateField.vue'
import MoneyInput from './MoneyInput.vue'
import Seg from './Seg.vue'
import Sheet from './Sheet.vue'

/** Lança (ou corrige) um aporte, uma retirada ou uma despesa do caixa da loja. */
const props = defineProps<{ aberto: boolean; lancamento: LancamentoApi | null }>()
const emit = defineEmits<{ fechar: []; salvo: []; excluido: [] }>()
const { sessao, hoje } = useApp()

const TIPOS = [{ id: 'APORTE', label: 'Aporte' }, { id: 'RETIRADA', label: 'Retirada' }, { id: 'DESPESA', label: 'Despesa' }]
const DICA: Record<TipoLancamento, string> = {
  APORTE: 'Dinheiro que você colocou no caixa (inclusive o saldo de abertura).',
  RETIRADA: 'Dinheiro que você tirou do caixa, por exemplo o lucro para uso pessoal.',
  DESPESA: 'Gasto da loja, como aluguel, internet ou frete.',
}
const tipo = ref<TipoLancamento>('APORTE')
const valor = ref(0)
const data = ref('')
const obs = ref('')
const erro = ref('')
const enviando = ref(false)
const confirmandoExclusao = ref(false)

const editando = computed(() => props.lancamento !== null)
const problema = computed(() => {
  if (valor.value <= 0) return 'Informe o valor'
  if (!data.value) return 'Informe a data'
  if (tipo.value === 'DESPESA' && !obs.value.trim()) return 'Diga com o que foi a despesa'
  return ''
})

watch(() => props.aberto, (aberto) => {
  if (!aberto) return
  const l = props.lancamento
  tipo.value = l?.tipo ?? 'APORTE'; valor.value = l?.valor ?? 0; data.value = l?.data ?? hoje.value; obs.value = l?.obs ?? ''
  erro.value = ''; confirmandoExclusao.value = false
}, { immediate: true })

async function salvar() {
  if (problema.value || enviando.value) return
  enviando.value = true; erro.value = ''
  try {
    const corpo = { tipo: tipo.value, valor: valor.value, data: data.value, obs: obs.value.trim() }
    if (props.lancamento) await caixaApi.editar(sessao.value, props.lancamento.id, corpo)
    else await caixaApi.lancar(sessao.value, corpo)
    emit('salvo')
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Não consegui salvar o lançamento.'
  } finally {
    enviando.value = false
  }
}

async function excluir() {
  if (!props.lancamento || enviando.value) return
  if (!confirmandoExclusao.value) { confirmandoExclusao.value = true; return }
  enviando.value = true; erro.value = ''
  try {
    await caixaApi.excluir(sessao.value, props.lancamento.id)
    emit('excluido')
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Não consegui excluir o lançamento.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <Sheet :aberto="aberto" @fechar="emit('fechar')">
    <h3>{{ editando ? 'Corrigir lançamento' : 'Lançar no caixa' }}</h3>
    <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px" @submit.prevent="salvar">
      <div class="field"><label>O que foi</label><Seg v-model="tipo as string" :itens="TIPOS" data-testid="lanc-tipo" /><div class="small" style="margin-top: 6px" data-testid="lanc-dica">{{ DICA[tipo] }}</div></div>
      <div class="field"><label for="lcValor">Valor</label><MoneyInput id="lcValor" v-model="valor" /></div>
      <div class="field"><label for="lcData">Data</label><DateField id="lcData" v-model="data" :max="hoje" min="2000-01-01" /></div>
      <div class="field">
        <label for="lcObs">{{ tipo === 'DESPESA' ? 'Com o quê' : 'Observação (opcional)' }}</label>
        <div class="inp"><input id="lcObs" v-model="obs" maxlength="200" :placeholder="tipo === 'DESPESA' ? 'Ex.: aluguel de outubro' : tipo === 'APORTE' ? 'Ex.: saldo de abertura' : 'Ex.: lucro do mês'" /></div>
      </div>
      <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
      <div v-else-if="problema && (valor > 0 || obs)" class="small" style="color: var(--bad)" role="status">{{ problema }}</div>
      <button class="btn b-pri b-block" type="submit" :disabled="!!problema || enviando" data-testid="lanc-salvar">
        {{ enviando ? 'Salvando…' : editando ? 'Salvar correção' : valor > 0 ? `Lançar ${fmt(valor)}` : 'Lançar' }}
      </button>
      <button v-if="editando" type="button" class="btn b-block" :class="confirmandoExclusao ? 'b-pri' : 'b-out'" :style="confirmandoExclusao ? 'background: var(--bad)' : ''" :disabled="enviando" data-testid="lanc-excluir" @click="excluir">
        {{ confirmandoExclusao ? 'Tem certeza? Toque de novo para excluir' : 'Excluir lançamento' }}
      </button>
      <div class="small">Aporte, retirada e despesa mexem só no saldo mostrado aqui. Recebimentos, repasses, empréstimos e compras entram sozinhos.</div>
    </form>
  </Sheet>
</template>
