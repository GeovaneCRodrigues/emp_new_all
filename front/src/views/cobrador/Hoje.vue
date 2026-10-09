<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { CobrancaApi } from '@/api/recebimentos'
import { recebimentosApi } from '@/api/recursos'
import CobrancaLinha from '@/components/CobrancaLinha.vue'
import FichasOperacao from '@/components/FichasOperacao.vue'
import { useApp } from '@/composables/useApp'
import { useAtrasadas } from '@/composables/useAtrasadas'
import { addDia } from '@/domain/datas'
import { fmt } from '@/domain/format'

const { sessao, hoje } = useApp()
const { atualizar } = useAtrasadas()
const fichas = ref<InstanceType<typeof FichasOperacao> | null>(null)

const atrasadas = ref<CobrancaApi[]>([])
const semana = ref<CobrancaApi[]>([])
const carregando = ref(true)
const erro = ref('')

async function carregar() {
  erro.value = ''
  try {
    const [a, h] = await Promise.all([
      recebimentosApi.cobrancas(sessao.value, { aba: 'atrasadas', limite: 100 }),
      recebimentosApi.cobrancas(sessao.value, { aba: 'hoje', limite: 100 }),
    ])
    atrasadas.value = a.itens; semana.value = h.itens
    atualizar(sessao.value)
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar o dia.'
  } finally {
    carregando.value = false
  }
}
onMounted(carregar)

// "esta semana" do servidor vai de hoje até daqui a 7 dias: aqui separo o que vence HOJE do resto
const venceHoje = computed(() => semana.value.filter((c) => c.vencimento === hoje.value))
const proximos7 = computed(() => semana.value.filter((c) => c.vencimento > hoje.value && c.vencimento <= addDia(hoje.value, 7)))
const somaFalta = (l: CobrancaApi[]) => Math.round(l.reduce((s, c) => s + c.falta, 0) * 100) / 100
/** Quanto cobrar hoje: o que já venceu mais o que vence hoje. */
const cobrarHoje = computed(() => somaFalta(atrasadas.value) + somaFalta(venceHoje.value))
const nHoje = computed(() => atrasadas.value.length + venceHoje.value.length)
const dataExtenso = computed(() => new Date(hoje.value + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }))
const chave = (c: CobrancaApi) => c.tipo + c.operacaoId + '-' + c.parcela
</script>

<template>
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar">Tentar de novo</button></div>
  <section class="hero">
    <div class="lbl">{{ dataExtenso }}</div>
    <div>
      <div class="lbl">Pra cobrar hoje</div>
      <div class="big disp num" data-testid="cobrar-hoje">{{ carregando ? '—' : fmt(cobrarHoje) }}</div>
      <div class="lbl" style="margin-top: 2px">{{ nHoje }} {{ nHoje === 1 ? 'parcela' : 'parcelas' }}<template v-if="atrasadas.length"> · <b style="color: #ffd6cf">{{ atrasadas.length }} atrasada{{ atrasadas.length > 1 ? 's' : '' }}</b></template></div>
    </div>
  </section>

  <div v-if="carregando" class="card empty">Carregando…</div>
  <template v-else>
    <div class="sec-t"><h2>Atrasadas</h2><span class="small">{{ atrasadas.length }}</span></div>
    <div class="card list" data-testid="secao-atrasadas">
      <CobrancaLinha v-for="c in atrasadas" :key="chave(c)" :c="c" @abrir="fichas?.abrir(c.tipo, c.operacaoId)" @receber="fichas?.receber(c.tipo, c.operacaoId, c.parcela)" @recibo="fichas?.recibo($event)" />
      <div v-if="!atrasadas.length" class="empty">Ninguém atrasado 🎉</div>
    </div>

    <div class="sec-t"><h2>Vencem hoje</h2><span class="small">{{ venceHoje.length }}</span></div>
    <div class="card list" data-testid="secao-hoje">
      <CobrancaLinha v-for="c in venceHoje" :key="chave(c)" :c="c" @abrir="fichas?.abrir(c.tipo, c.operacaoId)" @receber="fichas?.receber(c.tipo, c.operacaoId, c.parcela)" @recibo="fichas?.recibo($event)" />
      <div v-if="!venceHoje.length" class="empty">Nada vence hoje.</div>
    </div>

    <div class="sec-t"><h2>Próximos 7 dias</h2><span class="small">{{ proximos7.length }}</span></div>
    <div class="card list" data-testid="secao-proximos">
      <CobrancaLinha v-for="c in proximos7" :key="chave(c)" :c="c" @abrir="fichas?.abrir(c.tipo, c.operacaoId)" @receber="fichas?.receber(c.tipo, c.operacaoId, c.parcela)" @recibo="fichas?.recibo($event)" />
      <div v-if="!proximos7.length" class="empty">Nada nos próximos dias.</div>
    </div>
  </template>

  <FichasOperacao ref="fichas" @mudou="carregar" />
</template>
