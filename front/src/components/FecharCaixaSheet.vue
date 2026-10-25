<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { FechamentoLojaApi, PreviaFechamentoApi } from '@/api/caixaFechamentos'
import { caixaFechamentosApi } from '@/api/recursos'
import { useApp } from '@/composables/useApp'
import { addDia } from '@/domain/datas'
import { dmy, dmyA, fmt } from '@/domain/format'
import DateField from './DateField.vue'
import Sheet from './Sheet.vue'

/**
 * Fecha o caixa da loja até um dia. Como o cliente paga até meia-noite, o dia sugerido é ontem.
 * Mostra o que entrou e saiu desde o último fechamento, para o dono conciliar antes de confirmar.
 */
const props = defineProps<{ aberto: boolean; ultimo: FechamentoLojaApi | null }>()
const emit = defineEmits<{ fechar: []; fechado: [] }>()
const { sessao, hoje } = useApp()

const dia = ref('')
const obs = ref('')
const previa = ref<PreviaFechamentoApi | null>(null)
const carregando = ref(false)
const enviando = ref(false)
const erro = ref('')
const NOME_LADO = { EMPRESTIMO: 'Empréstimos', IPHONE: 'iPhones', SEM_LADO: 'Sem lado' } as const

const ontem = computed(() => addDia(hoje.value, -1))
const problema = computed(() => (!dia.value ? 'Escolha o dia' : erro.value ? '' : !previa.value ? 'Carregando o resumo…' : ''))
const ladosComMovimento = computed(() => (['EMPRESTIMO', 'IPHONE', 'SEM_LADO'] as const)
  .map((id) => ({ id, nome: NOME_LADO[id], ...(previa.value?.porLado[id] ?? { entrou: 0, saiu: 0 }) }))
  .filter((l) => l.entrou !== 0 || l.saiu !== 0))

watch(() => props.aberto, (aberto) => {
  if (!aberto) return
  // ontem; se já fechou depois disso (hoje, por exemplo), o dia do último fechamento
  dia.value = props.ultimo && props.ultimo.dia > ontem.value ? props.ultimo.dia : ontem.value
  obs.value = ''; erro.value = ''; previa.value = null
}, { immediate: true })

// uma resposta antiga que chega atrasada não pode sobrescrever a mais nova
let pedido = 0
watch([() => props.aberto, dia], async ([aberto, d]) => {
  if (!aberto || !/^\d{4}-\d{2}-\d{2}$/.test(d)) { previa.value = null; return }
  const meu = ++pedido
  carregando.value = true; erro.value = ''; previa.value = null
  try {
    const r = await caixaFechamentosApi.previa(sessao.value, d)
    if (meu === pedido) previa.value = r
  } catch (e) {
    if (meu === pedido) erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar o resumo.'
  } finally {
    if (meu === pedido) carregando.value = false
  }
}, { immediate: true })

async function confirmar() {
  if (!previa.value || enviando.value) return
  enviando.value = true; erro.value = ''
  try {
    await caixaFechamentosApi.fechar(sessao.value, { dia: dia.value, obs: obs.value.trim() || undefined })
    emit('fechado')
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Não consegui fechar o caixa.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <Sheet :aberto="aberto" @fechar="emit('fechar')">
    <h3>Fechar o caixa</h3>
    <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px" @submit.prevent="confirmar">
      <div class="field">
        <label for="fcDia">Fechar até o dia</label>
        <DateField id="fcDia" v-model="dia" :max="hoje" :min="ultimo?.dia ?? '2000-01-01'" />
        <div class="small" style="margin-top: 6px" data-testid="fechar-dica">Como o cliente paga até meia-noite, o normal é fechar o dia anterior.</div>
      </div>

      <div v-if="previa" class="card pad" data-testid="fechar-resumo" style="display: flex; flex-direction: column; gap: 8px">
        <div class="small" data-testid="fechar-periodo">{{ previa.de === previa.ate ? `Dia ${dmyA(previa.ate)}` : `De ${dmyA(previa.de)} a ${dmyA(previa.ate)}` }}</div>
        <div class="between"><span>Entrou</span><b class="num" style="color: var(--ok)" data-testid="fechar-entrou">+ {{ fmt(previa.entrou) }}</b></div>
        <div class="between"><span>Saiu</span><b class="num" style="color: var(--bad)" data-testid="fechar-saiu">− {{ fmt(previa.saiu) }}</b></div>
        <div class="between" style="border-top: 1px solid var(--line); padding-top: 8px"><span>Saldo do período</span><b class="num" data-testid="fechar-saldo">{{ fmt(previa.saldo) }}</b></div>
        <div v-for="l in ladosComMovimento" :key="l.id" class="small between" :data-lado="l.id"><span>{{ l.nome }}</span><span class="num">+ {{ fmt(l.entrou) }} · − {{ fmt(l.saiu) }}</span></div>
        <div v-if="!previa.itens.length" class="small" data-testid="fechar-vazio">Nada entrou nem saiu neste período.</div>
        <div v-else class="list" data-testid="fechar-itens" style="max-height: 220px; overflow-y: auto">
          <div v-for="m in previa.itens" :key="m.chave" class="li" :data-movimento="m.chave">
            <span class="mid"><span class="t" style="display: block">{{ m.titulo }}</span><span class="s" style="display: block">{{ dmy(m.data) }}{{ m.sub ? ` · ${m.sub}` : '' }}</span></span>
            <b class="num" style="white-space: nowrap" :style="{ color: m.entrada ? 'var(--ok)' : 'var(--bad)' }">{{ m.entrada ? '+' : '−' }} {{ fmt(m.valor) }}</b>
          </div>
        </div>
        <div v-if="previa.cortado" class="small" data-testid="fechar-cortado">A lista mostra só parte dos movimentos; os totais acima são do período todo.</div>
      </div>
      <div v-else-if="carregando" class="small" role="status">Carregando o resumo…</div>

      <div class="field">
        <label for="fcObs">Observação (opcional)</label>
        <div class="inp"><input id="fcObs" v-model="obs" maxlength="200" placeholder="Ex.: conferi o Pix e o dinheiro" /></div>
      </div>
      <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)" data-testid="fechar-erro">{{ erro }}</div>
      <button class="btn b-pri b-block" type="submit" :disabled="!previa || enviando || !!problema" data-testid="fechar-confirmar">
        {{ enviando ? 'Fechando…' : dia ? `Fechar o caixa até ${dmyA(dia)}` : 'Fechar o caixa' }}
      </button>
    </form>
  </Sheet>
</template>
