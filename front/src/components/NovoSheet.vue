<script setup lang="ts">
import { useRouter } from 'vue-router'
import Icon from './Icon.vue'
import Sheet from './Sheet.vue'

/** O botão central "Novo" do administrador: o que você quer fazer? */
defineProps<{ aberto: boolean }>()
const emit = defineEmits<{ fechar: [] }>()
const router = useRouter()

const OPCOES = [
  { id: 'venda', icone: 'smartphone', titulo: 'Venda de iPhone', texto: 'Aparelho, cliente e pagamento em 3 passos.', ir: '/vender' },
  { id: 'emprestimo', icone: 'landmark', titulo: 'Empréstimo', texto: 'Parcelado, só juros ou diária, com a data e a frequência que quiser.', ir: '/operacoes?novo=emprestimo' },
  { id: 'simular', icone: 'calculator', titulo: 'Só simular', texto: 'Ver as parcelas e o lucro sem gravar nada.', ir: '/simulador' },
] as const

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
