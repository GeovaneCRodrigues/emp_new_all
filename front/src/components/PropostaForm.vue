<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AparelhoApi } from '@/api/estoque'
import { ErroApi, type ClienteApi } from '@/api/clientes'
import type { PropostaApi, TipoProposta } from '@/api/propostas'
import { estoqueApi, propostasApi } from '@/api/recursos'
import { useApp } from '@/composables/useApp'
import { mascaraFone } from '@/domain/documentos'
import { fmt } from '@/domain/format'
import MoneyInput from './MoneyInput.vue'
import Seg from './Seg.vue'
import Sheet from './Sheet.vue'

/**
 * A proposta do indicador é só uma INTENÇÃO: o que o cliente quer. A loja aceita ou recusa e cadastra a venda/empréstimo.
 * `inicial` deixa a tela de origem (Estoque, Simulador) abrir já com o aparelho ou as parcelas preenchidos.
 */
const props = defineProps<{ aberto: boolean; cliente: ClienteApi | null; inicial?: { tipo?: TipoProposta; aparelhoId?: number; interesse?: string; parcelas?: number; obs?: string } }>()
const emit = defineEmits<{ fechar: []; enviada: [p: PropostaApi] }>()
const { sessao } = useApp()

const TIPOS = [{ id: 'VENDA', label: 'Venda de iPhone' }, { id: 'EMPRESTIMO', label: 'Empréstimo' }]
const tipo = ref<TipoProposta>('VENDA')
const interesse = ref('')
const aparelhoId = ref('')
const valor = ref(0)
const parcelas = ref('')
const obs = ref('')
const erro = ref('')
const enviando = ref(false)
const aparelhos = ref<AparelhoApi[]>([])

watch(() => props.aberto, async (aberto) => {
  if (!aberto) return
  const i = props.inicial ?? {}
  tipo.value = i.tipo ?? 'VENDA'; interesse.value = i.interesse ?? ''; aparelhoId.value = i.aparelhoId ? String(i.aparelhoId) : ''
  valor.value = 0; parcelas.value = i.parcelas ? String(i.parcelas) : ''; obs.value = i.obs ?? ''; erro.value = ''
  if (!aparelhos.value.length) aparelhos.value = (await estoqueApi.listar(sessao.value, { estado: 'DISPONIVEL', limite: 100 }).catch(() => null))?.itens ?? []
}, { immediate: true })

// escolher do estoque preenche o texto (que ainda dá para ajustar)
watch(aparelhoId, (id) => {
  const a = aparelhos.value.find((x) => String(x.id) === id)
  if (a) interesse.value = `${a.modelo} ${a.gb} GB ${a.cor}`
})
watch(tipo, (t) => { if (t === 'EMPRESTIMO') aparelhoId.value = '' })

const nParcelas = computed(() => (parcelas.value.trim() === '' ? null : Number(parcelas.value)))
const problema = computed(() => {
  if (tipo.value === 'VENDA' && !interesse.value.trim()) return 'Diga qual aparelho o cliente quer'
  if (tipo.value === 'EMPRESTIMO' && valor.value <= 0) return 'Diga quanto o cliente quer pegar'
  if (nParcelas.value !== null && (!Number.isInteger(nParcelas.value) || nParcelas.value < 1 || nParcelas.value > 120)) return 'Parcelas: um número de 1 a 120'
  return ''
})

async function enviar() {
  if (!props.cliente || problema.value || enviando.value) return
  enviando.value = true; erro.value = ''
  try {
    const p = await propostasApi.criar(sessao.value, {
      clienteId: props.cliente.id, tipo: tipo.value,
      ...(interesse.value.trim() ? { interesse: interesse.value.trim() } : {}), ...(aparelhoId.value ? { aparelhoId: Number(aparelhoId.value) } : {}),
      ...(tipo.value === 'EMPRESTIMO' && valor.value > 0 ? { valor: valor.value } : {}), ...(nParcelas.value ? { parcelas: nParcelas.value } : {}), ...(obs.value.trim() ? { obs: obs.value.trim() } : {}),
    })
    emit('enviada', p)
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <Sheet :aberto="aberto" @fechar="emit('fechar')">
    <template v-if="cliente">
      <h3>Mandar proposta</h3>
      <div class="small" style="margin-top: 2px">{{ cliente.nome }} · {{ mascaraFone(cliente.fone) }}</div>
      <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px" novalidate @submit.prevent="enviar">
        <div class="aviso">É só a intenção: a loja analisa e cadastra a venda ou o empréstimo no seu nome.</div>
        <div class="field"><label>O que ele quer?</label><Seg v-model="tipo" :itens="TIPOS" /></div>
        <template v-if="tipo === 'VENDA'">
          <div class="field">
            <label for="pAparelho">Escolha do estoque (opcional)</label>
            <div class="inp"><select id="pAparelho" v-model="aparelhoId"><option value="">Outro aparelho / ainda não sei</option><option v-for="a in aparelhos" :key="a.id" :value="String(a.id)">{{ a.modelo }} {{ a.gb }} GB {{ a.cor }} · {{ fmt(a.preco) }}</option></select></div>
          </div>
          <div class="field"><label for="pInteresse">Qual aparelho? *</label><div class="inp"><input id="pInteresse" v-model="interesse" maxlength="160" placeholder="Ex.: iPhone 14 128 GB preto" autocomplete="off" /></div></div>
        </template>
        <template v-else>
          <div class="field"><label for="pValor">Quanto quer pegar? *</label><MoneyInput id="pValor" v-model="valor" /></div>
          <div class="field"><label for="pInteresse">Para quê? (opcional)</label><div class="inp"><input id="pInteresse" v-model="interesse" maxlength="160" placeholder="Ex.: reformar a loja" autocomplete="off" /></div></div>
        </template>
        <div class="field"><label for="pParcelas">Em quantas parcelas? (opcional)</label><div class="inp"><input id="pParcelas" v-model="parcelas" inputmode="numeric" placeholder="Ex.: 10" /></div></div>
        <div class="field"><label for="pObs">Observação (opcional)</label><div class="inp"><textarea id="pObs" v-model="obs" maxlength="500" rows="2" placeholder="Ex.: pode dar R$ 500 de entrada"></textarea></div></div>
        <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
        <div v-else-if="problema" class="small" style="color: var(--bad)" role="status">{{ problema }}</div>
        <button class="btn b-pri b-block" type="submit" :disabled="!!problema || enviando">{{ enviando ? 'Enviando…' : 'Mandar proposta' }}</button>
      </form>
    </template>
  </Sheet>
</template>
