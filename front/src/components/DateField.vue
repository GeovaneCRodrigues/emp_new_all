<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useApp } from '@/composables/useApp'
import { addDia } from '@/domain/datas'
import { brParaIso, foraDoLimite, gradeDoMes, isoParaBr, mascaraData, mudarMes } from '@/domain/dataCampo'
import Icon from './Icon.vue'

/**
 * Campo de data: aparece como dd/mm/aaaa, dá para digitar só os números (08112026 vira 08/11/2026) ou tocar no ícone e
 * escolher no calendário, com os atalhos "Hoje" e "Daqui a 30 dias". Dias fora de `min`/`max` ficam apagados.
 * O valor é sempre ISO (AAAA-MM-DD), ou '' enquanto a data não estiver completa.
 */
const props = defineProps<{ modelValue: string; id?: string; min?: string; max?: string; rotulo?: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()
const { hoje } = useApp()

const texto = ref(isoParaBr(props.modelValue))
const aberto = ref(false)
const raiz = ref<HTMLElement | null>(null)
const vis = ref(visivelDe(props.modelValue))
let ultimoEmitido = props.modelValue

function visivelDe(iso: string) {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : hoje.value
  return { ano: Number(base.slice(0, 4)), mes: Number(base.slice(5, 7)) }
}

// o valor mudou por fora (a tela sugeriu uma data): atualiza o texto; se foi aqui dentro, não mexe no que a pessoa está digitando
watch(() => props.modelValue, (v) => { if (v !== ultimoEmitido) { texto.value = isoParaBr(v); vis.value = visivelDe(v) } ultimoEmitido = v })

function digitou(e: Event) {
  const el = e.target as HTMLInputElement
  texto.value = mascaraData(el.value)
  el.value = texto.value
  const iso = brParaIso(texto.value) ?? ''
  ultimoEmitido = iso
  emit('update:modelValue', iso)
  if (iso) vis.value = visivelDe(iso)
}
function escolher(iso: string) {
  texto.value = isoParaBr(iso); ultimoEmitido = iso
  emit('update:modelValue', iso)
  aberto.value = false
}

const nomeMes = computed(() => {
  const t = new Date(Date.UTC(vis.value.ano, vis.value.mes - 1, 1, 12)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return t.charAt(0).toUpperCase() + t.slice(1) // "Novembro de 2026"
})
const grade = computed(() => gradeDoMes(vis.value.ano, vis.value.mes))
const em30 = computed(() => addDia(hoje.value, 30))
const fora = (iso: string) => foraDoLimite(iso, props.min, props.max)
const mover = (d: number) => { vis.value = mudarMes(vis.value.ano, vis.value.mes, d) }

function alternar() { if (!aberto.value) vis.value = visivelDe(props.modelValue); aberto.value = !aberto.value }
const aoClicarFora = (e: MouseEvent) => { if (aberto.value && raiz.value && !raiz.value.contains(e.target as Node)) aberto.value = false }
document.addEventListener('mousedown', aoClicarFora)
onBeforeUnmount(() => document.removeEventListener('mousedown', aoClicarFora))
/** Esc fecha só o calendário (e não a folha em que o campo está). */
function aoTeclar(e: KeyboardEvent) { if (e.key === 'Escape' && aberto.value) { e.stopPropagation(); aberto.value = false } }
</script>

<template>
  <div ref="raiz" class="inp dp" @keydown="aoTeclar">
    <input :id="id" inputmode="numeric" autocomplete="off" placeholder="dd/mm/aaaa" maxlength="10" :aria-label="rotulo" :value="texto" @input="digitou" />
    <button type="button" class="dcal" aria-label="Escolher no calendário" :aria-expanded="aberto" @click="alternar"><Icon name="calendar-days" /></button>
    <div v-if="aberto" class="dpop" role="dialog" aria-label="Calendário" data-testid="calendario">
      <div class="dhead">
        <button type="button" aria-label="Mês anterior" @click="mover(-1)"><Icon name="chevron-left" /></button>
        <b>{{ nomeMes }}</b>
        <button type="button" aria-label="Próximo mês" @click="mover(1)"><Icon name="chevron-right" /></button>
      </div>
      <div class="dgrid">
        <span v-for="(l, i) in ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']" :key="i">{{ l }}</span>
        <template v-for="(c, i) in grade" :key="i">
          <i v-if="!c"></i>
          <button v-else type="button" :class="{ hoje: c.iso === hoje, on: c.iso === modelValue }" :disabled="fora(c.iso)" :data-dia="c.iso" @click="escolher(c.iso)">{{ c.dia }}</button>
        </template>
      </div>
      <div class="dfoot">
        <button type="button" data-atalho="hoje" :disabled="fora(hoje)" @click="escolher(hoje)">Hoje</button>
        <button type="button" data-atalho="30dias" :disabled="fora(em30)" @click="escolher(em30)">Daqui a 30 dias</button>
      </div>
    </div>
  </div>
</template>
