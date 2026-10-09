<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ClienteApi, SalvoCliente } from '@/api/clientes'
import type { PropostaApi, TipoProposta } from '@/api/propostas'
import { clientesApi } from '@/api/recursos'
import { useApp } from '@/composables/useApp'
import { useToast } from '@/composables/useToast'
import { mascaraFone } from '@/domain/documentos'
import { iniciais } from '@/domain/format'
import ClienteForm from './ClienteForm.vue'
import Icon from './Icon.vue'
import PropostaForm from './PropostaForm.vue'
import Sheet from './Sheet.vue'

/**
 * O caminho do indicador até a proposta: escolher um cliente dele (ou cadastrar um novo) e dizer o que o cliente quer.
 * Quem chama (Indicar, Meus clientes, Estoque, Simulador) usa `abrir()`; `inicial` já vem com o aparelho/parcelas.
 */
type Inicial = { tipo?: TipoProposta; aparelhoId?: number; interesse?: string; parcelas?: number; obs?: string }
const emit = defineEmits<{ enviada: [p: PropostaApi] }>()
const { sessao } = useApp()
const { mostrar } = useToast()

const escolhendo = ref(false)
const busca = ref('')
const meus = ref<ClienteApi[]>([])
const cadastrando = ref(false)
const cliente = ref<ClienteApi | null>(null)
const inicial = ref<Inicial | undefined>()

async function buscar() {
  const r = await clientesApi.listar(sessao.value, { busca: busca.value.trim() || undefined, limite: 20 }).catch(() => null)
  if (r) meus.value = r.itens
}
let espera: ReturnType<typeof setTimeout> | undefined
watch(busca, () => { clearTimeout(espera); espera = setTimeout(buscar, 300) })

/** Sem `cliente`, pergunta para quem; com `cliente`, vai direto à proposta. */
function abrir(opcoes: { cliente?: ClienteApi; inicial?: Inicial } = {}) {
  inicial.value = opcoes.inicial
  if (opcoes.cliente) { cliente.value = opcoes.cliente; return }
  escolhendo.value = true; busca.value = ''; buscar()
}
function escolher(c: ClienteApi) { escolhendo.value = false; cliente.value = c }
function aoCadastrar(r: SalvoCliente) {
  cadastrando.value = false; escolhendo.value = false
  mostrar(`${r.cliente.nome} cadastrado. Agora diga o que ele quer.`)
  cliente.value = r.cliente
}
function aoEnviar(p: PropostaApi) {
  cliente.value = null
  mostrar(`Proposta de ${p.cliente.nome} enviada para a loja.`)
  emit('enviada', p)
}
defineExpose({ abrir })
</script>

<template>
  <Sheet :aberto="escolhendo" @fechar="escolhendo = false">
    <h3>Indicar para quem?</h3>
    <div class="field" style="margin-top: 12px"><div class="inp"><input v-model="busca" placeholder="Buscar pelo nome" aria-label="Buscar cliente" autocomplete="off" /></div></div>
    <div class="list card" style="margin-top: 10px" data-testid="escolher-cliente">
      <button v-for="c in meus" :key="c.id" class="li" :data-cliente="c.id" @click="escolher(c)">
        <span class="ini">{{ iniciais(c.nome) }}</span>
        <div class="mid"><div class="t">{{ c.nome }}</div><div class="s">{{ mascaraFone(c.fone) }}</div></div>
      </button>
      <div v-if="!meus.length" class="empty">Nenhum cliente seu com esse nome.</div>
    </div>
    <button class="btn b-out b-block" style="margin-top: 12px" data-testid="cadastrar-novo" @click="cadastrando = true"><Icon name="plus" small />Cadastrar um cliente novo</button>
  </Sheet>
  <ClienteForm :aberto="cadastrando" :cliente="null" @fechar="cadastrando = false" @salvo="aoCadastrar" />
  <PropostaForm :aberto="cliente !== null" :cliente="cliente" :inicial="inicial" @fechar="cliente = null" @enviada="aoEnviar" />
</template>
