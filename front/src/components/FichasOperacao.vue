<script setup lang="ts">
import { ref } from 'vue'
import type { EmprestimoApi } from '@/api/emprestimos'
import type { AlvoApi } from '@/api/recebimentos'
import { emprestimosApi, vendasApi } from '@/api/recursos'
import type { VendaApi } from '@/api/vendas'
import { useApp } from '@/composables/useApp'
import EmprestimoFicha from './EmprestimoFicha.vue'
import RecebimentoFluxo from './RecebimentoFluxo.vue'
import VendaFicha from './VendaFicha.vue'

/**
 * Tudo o que acontece em cima de uma venda ou de um empréstimo, para as telas só abrirem a ficha:
 * a ficha (com Recebi, pedidos e acordo), o recebimento, o recibo e o desfazer. Avisa `mudou` depois de qualquer mudança.
 */
const emit = defineEmits<{ mudou: [] }>()
const { sessao } = useApp()

const venda = ref<VendaApi | null>(null)
const emprestimo = ref<EmprestimoApi | null>(null)
const fluxo = ref<InstanceType<typeof RecebimentoFluxo> | null>(null)

async function abrir(tipo: AlvoApi, id: number) {
  if (tipo === 'VENDA') venda.value = await vendasApi.obter(sessao.value, id).catch(() => null)
  else emprestimo.value = await emprestimosApi.obter(sessao.value, id).catch(() => null)
}
const receber = (tipo: AlvoApi, id: number, parcela: number) => fluxo.value?.iniciar(tipo, id, parcela)
const recibo = (id: number) => fluxo.value?.abrirRecibo(id)

/** Depois de qualquer mudança: relê a ficha que está aberta e avisa a tela. */
async function aoMudar() {
  if (venda.value) venda.value = await vendasApi.obter(sessao.value, venda.value.id).catch(() => null)
  if (emprestimo.value) emprestimo.value = await emprestimosApi.obter(sessao.value, emprestimo.value.id).catch(() => null)
  emit('mudou')
}

defineExpose({ abrir, receber, recibo })
</script>

<template>
  <VendaFicha :venda="venda" @fechar="venda = null" @receber="(p) => venda && receber('VENDA', venda.id, p)" @recibo="recibo" @desfazer="(id) => fluxo?.desfazer(id)" @mudou="aoMudar" />
  <EmprestimoFicha :emprestimo="emprestimo" @fechar="emprestimo = null" @receber="(p) => emprestimo && receber('EMPRESTIMO', emprestimo.id, p)" @recibo="recibo" @desfazer="(id) => fluxo?.desfazer(id)" @mudou="aoMudar" />
  <RecebimentoFluxo ref="fluxo" @mudou="aoMudar" />
</template>
