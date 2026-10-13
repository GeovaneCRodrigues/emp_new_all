<script setup lang="ts">
import { computed } from 'vue'
import { mesNome } from '@/domain/cronograma'
import { fmt0 } from '@/domain/format'

/** Barras por mês, feitas em CSS. Cada série tem uma cor e um valor por mês (na mesma ordem de `meses`). */
const props = withDefaults(defineProps<{ meses: string[]; series: { l: string; v: number[]; c: string }[]; hoje: string; alt?: number }>(), { alt: 130 })
const max = computed(() => Math.max(1, ...props.series.flatMap((s) => s.v)))
const curto = (ym: string) => mesNome(ym).slice(0, 3)
const altura = (v: number) => Math.max(2, (v / max.value) * props.alt)
</script>

<template>
  <div>
    <div class="barras" :style="{ height: `${alt + 34}px` }" data-testid="rel-barras">
      <div v-for="(m, i) in meses" :key="m" class="col" :data-mes="m">
        <div class="bs" :style="{ height: `${alt}px` }">
          <span v-for="s in series" :key="s.l" :title="`${s.l} ${fmt0(s.v[i] ?? 0)}`" :data-serie="s.l" :data-valor="s.v[i] ?? 0" :style="{ height: `${altura(s.v[i] ?? 0)}px`, background: s.c }" />
        </div>
        <span class="small" :class="{ hj: m === hoje.slice(0, 7) }">{{ curto(m) }}</span>
      </div>
    </div>
    <div class="leg"><span v-for="s in series" :key="s.l"><i :style="{ background: s.c }" />{{ s.l }}</span></div>
  </div>
</template>
