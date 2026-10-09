<script setup lang="ts">
import { ref } from 'vue'
import { ErroApi } from '@/api/clientes'
import { recebimentosApi } from '@/api/recursos'
import type { AlvoApi, ReciboApi, RegistradoApi } from '@/api/recebimentos'
import { useApp } from '@/composables/useApp'
import { useAtrasadas } from '@/composables/useAtrasadas'
import { useToast } from '@/composables/useToast'
import { fmt } from '@/domain/format'
import ReceberSheet from './ReceberSheet.vue'
import ReciboSheet from './ReciboSheet.vue'

/**
 * Todo o caminho de um recebimento: a folha de "Recebi", o recibo e o aviso com "Desfazer".
 * Quem usa só chama `iniciar` (ou `abrirRecibo`) e escuta `mudou` para recarregar a tela.
 */
const emit = defineEmits<{ mudou: [] }>()
const { sessao } = useApp()
const { mostrar } = useToast()
const { atualizar } = useAtrasadas()

const alvo = ref<{ tipo: AlvoApi; operacaoId: number; parcela: number } | null>(null)
const recibo = ref<ReciboApi | null>(null)

function iniciar(tipo: AlvoApi, operacaoId: number, parcela: number) { alvo.value = { tipo, operacaoId, parcela } }
async function abrirRecibo(id: number) {
  try { recibo.value = await recebimentosApi.recibo(sessao.value, id) }
  catch (e) { mostrar(e instanceof ErroApi ? e.message : 'Não consegui abrir o recibo.') }
}

async function desfazer(id: number) {
  try {
    await recebimentosApi.desfazer(sessao.value, id)
    if (recibo.value?.id === id) recibo.value = null
    mostrar('Recebimento desfeito. Tudo voltou como estava.')
    atualizar(sessao.value)
    emit('mudou')
  } catch (e) {
    mostrar(e instanceof ErroApi ? e.message : 'Não consegui desfazer.')
  }
}

function aoRegistrar(r: RegistradoApi) {
  alvo.value = null
  recibo.value = r.recibo
  mostrar(`${fmt(r.recibo.valor)} recebidos de ${r.recibo.cliente.nome.split(' ')[0]}.`, { texto: 'Desfazer', executar: () => desfazer(r.recibo.id) })
  atualizar(sessao.value)
  emit('mudou')
}

defineExpose({ iniciar, abrirRecibo, desfazer })
</script>

<template>
  <ReceberSheet :alvo="alvo" @fechar="alvo = null" @registrado="aoRegistrar" />
  <ReciboSheet :recibo="recibo" @fechar="recibo = null" />
</template>
