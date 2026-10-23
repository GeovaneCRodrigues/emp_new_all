<script setup lang="ts">
import { computed, ref } from 'vue'
import { mesLabel, mesNome } from '@/domain/cronograma'
import { fmt0 } from '@/domain/format'
import type { PontoGrafico } from '@/domain/reinvestir'

/** Três gráficos do lucro: barras empilhadas por mês (retirada e reinvestir), o acumulado reinvestido e a rosca dos próximos meses. Tudo em CSS e SVG, sem biblioteca. */
const props = defineProps<{ pontos: PontoGrafico[]; hoje: string; retirada: number; totalRetirada: number; totalReinvestir: number }>()

const COR_REINVESTIR = 'var(--primary)', COR_RETIRADA = 'var(--gold)'
const mesAtual = computed(() => props.hoje.slice(0, 7))
const curto = (ym: string) => mesNome(ym).slice(0, 3)
const max = computed(() => Math.max(1, ...props.pontos.map((p) => p.lucro)))
const ALT = 120
const alt = (v: number) => (v > 0 ? Math.max(2, (v / max.value) * ALT) : 0)

const escolhido = ref<string | null>(null)
const detalhe = computed(() => props.pontos.find((p) => p.mes === (escolhido.value ?? mesAtual.value)) ?? null)
const escolher = (mes: string) => { escolhido.value = escolhido.value === mes ? null : mes }

// linha do acumulado: x espalhado, y pelo maior acumulado
const L = 300, A = 90
const maxAcum = computed(() => Math.max(1, ...props.pontos.map((p) => p.acumulado)))
const xy = (i: number, v: number) => [props.pontos.length > 1 ? (i / (props.pontos.length - 1)) * L : L / 2, A - (v / maxAcum.value) * (A - 6) - 3] as const
const pt = (i: number) => xy(i, props.pontos[i].acumulado)
const linhaCheia = computed(() => props.pontos.map((p, i) => ({ p, i })).filter(({ p }) => p.mes <= mesAtual.value).map(({ i }) => pt(i).join(',')).join(' '))
const linhaTracejada = computed(() => {
  const i0 = props.pontos.findIndex((p) => p.mes === mesAtual.value)
  return props.pontos.map((_, i) => i).filter((i) => i >= Math.max(0, i0)).map((i) => pt(i).join(',')).join(' ')
})

const totalRosca = computed(() => props.totalRetirada + props.totalReinvestir)
const fatiaRetirada = computed(() => (totalRosca.value > 0 ? (props.totalRetirada / totalRosca.value) * 100 : 0))
const rosca = computed(() => (totalRosca.value > 0 ? `conic-gradient(${COR_RETIRADA} 0 ${fatiaRetirada.value}%, ${COR_REINVESTIR} ${fatiaRetirada.value}% 100%)` : 'var(--border)'))
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 14px">
    <div class="card pad" data-testid="rei-empilhado">
      <div class="between"><b style="color: var(--strong)">Para onde vai o lucro de cada mês</b><span class="small">claro = esperado</span></div>
      <div style="width: 100%"><div class="barras" :style="{ height: `${ALT + 34}px` }">
        <div v-for="p in pontos" :key="p.mes" role="button" tabindex="0" class="col" :class="{ sel: detalhe?.mes === p.mes }" :data-mes="p.mes" :data-lucro="p.lucro" :aria-label="`${mesLabel(p.mes)}: lucro ${fmt0(p.lucro)}`" style="cursor: pointer" @click="escolher(p.mes)" @keydown.enter.prevent="escolher(p.mes)" @keydown.space.prevent="escolher(p.mes)">
          <div class="bs" :style="{ flex: 'none', width: '18px', height: `${ALT}px`, flexDirection: 'column-reverse', alignItems: 'center', justifyContent: 'flex-start', gap: '0' }">
            <span data-parte="reinvestir-real" :style="{ flex: 'none', width: '18px', height: `${alt(p.real.reinvestir)}px`, background: COR_REINVESTIR }" />
            <span data-parte="retirada-real" :style="{ flex: 'none', width: '18px', height: `${alt(p.real.retirada)}px`, background: COR_RETIRADA }" />
            <span data-parte="reinvestir-esperado" :style="{ flex: 'none', width: '18px', height: `${alt(p.esperado.reinvestir)}px`, background: COR_REINVESTIR, opacity: 0.4 }" />
            <span data-parte="retirada-esperado" :style="{ flex: 'none', width: '18px', height: `${alt(p.esperado.retirada)}px`, background: COR_RETIRADA, opacity: 0.45 }" />
          </div>
          <span class="small" :class="{ hj: p.mes === mesAtual }">{{ curto(p.mes) }}</span>
        </div>
      </div>
      </div>
      <div class="leg"><span><i :style="{ background: COR_REINVESTIR }" />Reinvestir</span><span><i :style="{ background: COR_RETIRADA }" />Você retira</span></div>
      <div v-if="detalhe" class="small" style="margin-top: 6px" data-testid="rei-detalhe">
        <b style="text-transform: capitalize; color: var(--strong)">{{ mesLabel(detalhe.mes) }}</b>: lucro <b class="num">{{ fmt0(detalhe.lucro) }}</b> · você retira <b class="num">{{ fmt0(detalhe.real.retirada + detalhe.esperado.retirada) }}</b> · reinveste <b class="num">{{ fmt0(detalhe.real.reinvestir + detalhe.esperado.reinvestir) }}</b>
        <template v-if="detalhe.esperado.reinvestir + detalhe.esperado.retirada > 0 && detalhe.real.reinvestir + detalhe.real.retirada > 0"> (já recebido {{ fmt0(detalhe.real.reinvestir + detalhe.real.retirada) }} + esperado {{ fmt0(detalhe.esperado.reinvestir + detalhe.esperado.retirada) }})</template>
      </div>
    </div>

    <div class="duo">
      <div class="card pad" data-testid="rei-acumulado">
        <div class="between"><b style="color: var(--strong)">Quanto você já reinvestiu</b><b class="num" style="color: var(--primary)">{{ fmt0(pontos[pontos.length - 1]?.acumulado ?? 0) }}</b></div>
        <svg style="width: 100%" :viewBox="`-4 0 ${L + 8} ${A}`" width="100%" :height="A + 10" role="img" aria-label="Reinvestido somando mês a mês" preserveAspectRatio="none">
          <polyline :points="linhaCheia" fill="none" :stroke="COR_REINVESTIR" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
          <polyline :points="linhaTracejada" fill="none" :stroke="COR_REINVESTIR" stroke-width="2.5" stroke-dasharray="5 4" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
          <circle v-for="(p, i) in pontos" :key="p.mes" :cx="pt(i)[0]" :cy="pt(i)[1]" r="3" :fill="p.mes === mesAtual ? 'var(--strong)' : COR_REINVESTIR" />
        </svg>
        <div class="between small"><span style="text-transform: capitalize">{{ mesNome(pontos[0]?.mes ?? mesAtual) }}</span><span>tracejado = esperado</span><span style="text-transform: capitalize">{{ mesNome(pontos[pontos.length - 1]?.mes ?? mesAtual) }}</span></div>
      </div>

      <div class="card pad" style="display: flex; align-items: center; gap: 16px" data-testid="rei-rosca">
        <div :style="{ width: '112px', height: '112px', borderRadius: '50%', background: rosca, flex: 'none', display: 'grid', placeItems: 'center' }" role="img" :aria-label="`Retirada ${Math.round(fatiaRetirada)}% e reinvestir ${Math.round(100 - fatiaRetirada)}%`">
          <div style="width: 70px; height: 70px; border-radius: 50%; background: var(--surface); display: grid; place-items: center; text-align: center"><b class="num" style="font-size: 15px; color: var(--strong)">{{ Math.round(fatiaRetirada) }}%</b></div>
        </div>
        <div class="small" style="display: flex; flex-direction: column; gap: 6px">
          <b style="color: var(--strong)">Próximos 6 meses</b>
          <span><i :style="{ background: COR_RETIRADA, display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', marginRight: '6px' }" />Você retira <b class="num">{{ fmt0(totalRetirada) }}</b></span>
          <span><i :style="{ background: COR_REINVESTIR, display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', marginRight: '6px' }" />Reinvestir <b class="num">{{ fmt0(totalReinvestir) }}</b></span>
        </div>
      </div>
    </div>
  </div>
</template>
