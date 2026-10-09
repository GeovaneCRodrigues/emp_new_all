<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ErroApi } from '@/api/clientes'
import type { IndicadorApi } from '@/api/indicadores'
import type { CobrancaApi } from '@/api/recebimentos'
import type { DetalheRepasseApi } from '@/api/repasses'
import { emprestimosApi, indicadoresApi, recebimentosApi, repassesApi, vendasApi } from '@/api/recursos'
import CobrancaLinha from '@/components/CobrancaLinha.vue'
import Icon from '@/components/Icon.vue'
import IndicarFluxo from '@/components/IndicarFluxo.vue'
import { COR_NIVEL } from '@/data/niveis'
import { useApp } from '@/composables/useApp'
import { useAtrasadas } from '@/composables/useAtrasadas'
import { fmt, fmt0 } from '@/domain/format'

/** O Início do indicador: o que cobrar hoje, quanto os clientes devem, o que já recebeu e vai ganhar, e o nível. */
const router = useRouter()
const { sessao, hoje } = useApp()
const { atualizar } = useAtrasadas()
const fluxo = ref<InstanceType<typeof IndicarFluxo> | null>(null)

const atrasadas = ref<CobrancaApi[]>([])
const venceHoje = ref<CobrancaApi[]>([])
const devem = ref(0)
const repasse = ref<DetalheRepasseApi | null>(null)
const eu = ref<IndicadorApi | null>(null)
const carregando = ref(true)
const erro = ref('')

onMounted(async () => {
  try {
    const s = sessao.value
    const [atr, ho, rv, re, rep, ind] = await Promise.all([
      recebimentosApi.cobrancas(s, { aba: 'atrasadas', limite: 100 }), recebimentosApi.cobrancas(s, { aba: 'hoje', limite: 100 }),
      vendasApi.resumo(s), emprestimosApi.resumo(s), repassesApi.detalhe(s, s.indicadorId ?? -1), indicadoresApi.obter(s, s.indicadorId ?? -1),
    ])
    atrasadas.value = atr.itens
    venceHoje.value = ho.itens.filter((c) => c.vencimento === hoje.value)
    devem.value = Math.round((rv.aReceber + re.aReceber) * 100) / 100
    repasse.value = rep; eu.value = ind
    atualizar(s)
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar o início.'
  } finally {
    carregando.value = false
  }
})

const prax = computed(() => [...atrasadas.value, ...venceHoje.value])
const praCobrarHoje = computed(() => Math.round(prax.value.reduce((x, c) => x + c.falta, 0) * 100) / 100)
const vaiGanhar = computed(() => (repasse.value ? Math.round((repasse.value.resumo.aPagar + repasse.value.resumo.vaiLiberar) * 100) / 100 : 0))
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`
const progressoNivel = computed(() => {
  const n = eu.value
  if (!n) return 0
  if (!n.proximoNivel) return 100
  const base = n.nivel.minOperacoes
  return Math.max(0, Math.min(100, Math.round(((n.operacoes - base) / (n.proximoNivel.minOperacoes - base)) * 100)))
})
const MAIS = [
  { id: 'vendas', label: 'Minhas vendas', icon: 'badge-dollar-sign' }, { id: 'estoque', label: 'Estoque', icon: 'smartphone' },
  { id: 'simulador', label: 'Simulador', icon: 'calculator' }, { id: 'niveis', label: 'Níveis', icon: 'award' },
]
const chave = (c: CobrancaApi) => c.tipo + c.operacaoId + '-' + c.parcela
</script>

<template>
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
  <div class="atalhos" data-testid="atalhos">
    <button data-atalho="indicar" @click="fluxo?.abrir()"><span class="ic"><Icon name="user-plus" /></span>Indicar</button>
    <button data-atalho="cobranca" @click="router.push('/cobranca')"><span class="ic"><Icon name="hand-coins" /></span>Cobrança</button>
    <button data-atalho="simular" @click="router.push('/simulador')"><span class="ic"><Icon name="calculator" /></span>Simular</button>
  </div>

  <div class="sec-t"><h2>Pra cobrar hoje · <span class="num" data-testid="pra-cobrar-hoje">{{ carregando ? '—' : fmt(praCobrarHoje) }}</span></h2><button @click="router.push('/cobranca')">Cobrança</button></div>
  <div class="card list" data-testid="cobrar-hoje">
    <CobrancaLinha v-for="c in prax.slice(0, 5)" :key="chave(c)" :c="c" sem-receber />
    <div v-if="!prax.length && !carregando" class="empty">Nada pra cobrar hoje 🎉</div>
    <div v-if="carregando" class="empty">Carregando…</div>
  </div>

  <div class="kpi3" data-testid="kpis">
    <div><div class="lbl">Seus clientes devem</div><div class="val num" data-testid="devem">{{ fmt0(devem) }}</div><div class="small">pra receber</div></div>
    <div><div class="lbl">Já recebi</div><div class="val num" data-testid="ja-recebi">{{ fmt0(repasse?.resumo.pago ?? 0) }}</div><div class="small">de repasse</div></div>
    <div><div class="lbl">Vai ganhar</div><div class="val num" data-testid="vai-ganhar">{{ fmt0(vaiGanhar) }}</div><div class="small">até quitarem</div></div>
  </div>

  <button v-if="eu" class="nivel-card" :style="{ marginTop: '14px', background: COR_NIVEL[eu.nivel.id]?.fundo, borderColor: COR_NIVEL[eu.nivel.id]?.cor }" data-testid="nivel" @click="router.push('/niveis')">
    <span class="ic" :style="{ background: COR_NIVEL[eu.nivel.id]?.cor, color: '#fff', width: '36px', height: '36px', borderRadius: '50%', display: 'grid', placeItems: 'center' }"><Icon name="award" small /></span>
    <div style="flex: 1; min-width: 0">
      <div class="val">Nível {{ eu.nivel.nome }} · {{ pct(eu.pct) }} do lucro</div>
      <div class="small">{{ eu.operacoes }} {{ eu.operacoes === 1 ? 'operação' : 'operações' }}<template v-if="eu.proximoNivel"> · faltam {{ eu.faltamParaProximo }} pro {{ eu.proximoNivel.nome }} ({{ pct(eu.proximoNivel.pct) }})</template></div>
      <div class="bar" style="margin-top: 8px"><i :style="{ width: progressoNivel + '%', background: COR_NIVEL[eu.nivel.id]?.cor }"></i></div>
    </div>
    <Icon name="chevron-right" small />
  </button>

  <!-- no celular, o que no computador fica na lateral -->
  <div class="so-celular" style="margin-top: 14px">
    <div class="sec-t"><h2>Mais</h2></div>
    <div class="card list">
      <button v-for="m in MAIS" :key="m.id" class="li" :data-mais="m.id" @click="router.push('/' + m.id)"><Icon :name="m.icon" /><span class="mid"><span class="t">{{ m.label }}</span></span><Icon name="chevron-right" small /></button>
    </div>
  </div>
  <IndicarFluxo ref="fluxo" />
</template>
