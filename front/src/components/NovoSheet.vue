<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useApp } from '@/composables/useApp'
import Icon from './Icon.vue'
import Sheet from './Sheet.vue'

/** O botão central "Novo": o que você quer fazer? (o administrador e o indicador têm opções diferentes) */
defineProps<{ aberto: boolean }>()
const emit = defineEmits<{ fechar: [] }>()
const router = useRouter()

const { sessao } = useApp()
const OPCOES_ADMIN = [
  { id: 'venda', icone: 'smartphone', titulo: 'Venda de iPhone', texto: 'Aparelho, cliente e pagamento em 3 passos.', ir: '/vender' },
  { id: 'emprestimo', icone: 'landmark', titulo: 'Empréstimo', texto: 'Parcelado, só juros ou diária, com a data e a frequência que quiser.', ir: '/operacoes?novo=emprestimo' },
  { id: 'simular', icone: 'calculator', titulo: 'Só simular', texto: 'Ver as parcelas e o lucro sem gravar nada.', ir: '/simulador' },
] as const
const OPCOES_INDICADOR = [
  { id: 'recebi', icone: 'hand-coins', titulo: 'Recebi de um cliente', texto: 'Avise a loja que um cliente seu pagou uma parcela.', ir: '/cobranca' },
  { id: 'indicar', icone: 'user-plus', titulo: 'Indicar cliente', texto: 'Cadastre o cliente e diga o que ele quer: venda ou empréstimo.', ir: '/indicar' },
  { id: 'simular', icone: 'calculator', titulo: 'Só simular', texto: 'Ver as parcelas para mostrar ao cliente, sem mandar nada.', ir: '/simulador' },
] as const
const OPCOES = computed(() => (sessao.value.perfil === 'INDICADOR' ? OPCOES_INDICADOR : OPCOES_ADMIN))

function escolher(destino: string) {
  emit('fechar')
  router.push(destino)
}
</script>

<template>
  <Sheet :aberto="aberto" @fechar="emit('fechar')">
    <h3>O que você quer fazer?</h3>
    <div class="list" style="margin-top: 12px" data-testid="novo-opcoes">
      <button v-for="o in OPCOES" :key="o.id" class="li" :data-novo="o.id" @click="escolher(o.ir)">
        <span class="ini"><Icon :name="o.icone" /></span>
        <div class="mid"><div class="t">{{ o.titulo }}</div><div class="s">{{ o.texto }}</div></div>
      </button>
    </div>
  </Sheet>
</template>
