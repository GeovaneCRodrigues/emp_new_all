<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import Abas from '@/components/Abas.vue'
import CobLinha from '@/components/CobLinha.vue'
import Seg from '@/components/Seg.vue'
import { useApp, type ItemCobranca } from '@/composables/useApp'
import { faltaP, pagoP } from '@/domain/calc'
import { addDia, diasEntre } from '@/domain/datas'
import { fmt } from '@/domain/format'

const router = useRouter()
const { hoje, cobrancas } = useApp()

const tipo = ref('todos')
const aba = ref('atrasadas')

const porTipo = computed(() => (tipo.value === 'todos' ? cobrancas.value : cobrancas.value.filter((x) => (x.op.tipo === 'EMP') === (tipo.value === 'emp'))))
const poVenc = (a: ItemCobranca, b: ItemCobranca) => a.p.venc.localeCompare(b.p.venc)
const grupos = computed(() => {
  const h = hoje.value
  const abertas = porTipo.value.filter((x) => !x.p.pago)
  const desde = addDia(h, -30)
  return {
    atrasadas: abertas.filter((x) => x.p.venc < h).sort(poVenc),
    hoje: abertas.filter((x) => x.p.venc >= h && diasEntre(h, x.p.venc) <= 7).sort(poVenc),
    proximas: abertas.filter((x) => diasEntre(h, x.p.venc) > 7 && diasEntre(h, x.p.venc) <= 45).sort(poVenc),
    recebidas: porTipo.value.filter((x) => x.p.pagos.some((g) => g.data >= desde)).sort((a, b) => b.p.pagos.at(-1)!.data.localeCompare(a.p.pagos.at(-1)!.data)),
  }
})
const lista = computed(() => grupos.value[aba.value as keyof typeof grupos.value])
const total = computed(() => lista.value.reduce((s, x) => s + (aba.value === 'recebidas' ? pagoP(x.p) : faltaP(x.p)), 0))
const legenda = computed(() => ({ atrasadas: 'em atraso', hoje: 'vence nos próximos 7 dias', proximas: 'nos próximos 45 dias', recebidas: 'nos últimos 30 dias' })[aba.value])

const atrasoDe = (f: (x: ItemCobranca) => boolean) => new Set(cobrancas.value.filter((x) => !x.p.pago && x.p.venc < hoje.value && f(x)).map((x) => x.op.id)).size
const tipos = computed(() => [
  { id: 'todos', label: 'Tudo', icon: 'layers', n: atrasoDe(() => true) },
  { id: 'iphone', label: 'iPhones', icon: 'smartphone', n: atrasoDe((x) => x.op.tipo !== 'EMP') },
  { id: 'emp', label: 'Empréstimos', icon: 'landmark', n: atrasoDe((x) => x.op.tipo === 'EMP') },
])
const filtros = computed(() => [
  { id: 'atrasadas', label: 'Atrasadas' + (grupos.value.atrasadas.length ? ` · ${grupos.value.atrasadas.length}` : '') },
  { id: 'hoje', label: 'Esta semana' + (grupos.value.hoje.length ? ` · ${grupos.value.hoje.length}` : '') },
  { id: 'proximas', label: 'Próximas' + (grupos.value.proximas.length ? ` · ${grupos.value.proximas.length}` : '') },
  { id: 'recebidas', label: 'Recebidas' },
])
</script>

<template>
  <Abas v-model="tipo" :itens="tipos" />
  <Seg v-model="aba" :itens="filtros" />
  <div class="card">
    <div class="totbar">
      <span class="small">{{ lista.length }} {{ lista.length === 1 ? 'parcela' : 'parcelas' }} {{ legenda }}</span>
      <b class="num" style="font-size: 16px" :style="{ color: aba === 'atrasadas' ? 'var(--bad)' : aba === 'recebidas' ? 'var(--ok)' : 'var(--strong)' }">{{ fmt(total) }}</b>
    </div>
    <div class="list">
      <CobLinha v-for="x in lista" :key="x.op.id + '-' + x.p.n" :x="x" @abrir="router.push('/operacoes')" />
      <div v-if="!lista.length" class="empty">Nada aqui.</div>
    </div>
  </div>
</template>
