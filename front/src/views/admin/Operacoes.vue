<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ErroApi } from '@/api/clientes'
import { vendasApi } from '@/api/recursos'
import type { ResumoVendasApi, VendaApi } from '@/api/vendas'
import Abas from '@/components/Abas.vue'
import OperacaoCard from '@/components/OperacaoCard.vue'
import Seg from '@/components/Seg.vue'
import VendaCard from '@/components/VendaCard.vue'
import VendaFicha from '@/components/VendaFicha.vue'
import { useApp } from '@/composables/useApp'
import { fmt0 } from '@/domain/format'
import type { Operacao } from '@/domain/types'

const route = useRoute()
const { d, contas, sessao } = useApp()

const ehAdmin = computed(() => sessao.value.perfil === 'ADMIN')
const aba = ref<'iphone' | 'emp'>('iphone')
const filtro = ref('ATIVA')

// ---- iPhones: vem da API ----
const vendas = ref<VendaApi[]>([])
const total = ref(0)
const pagina = ref(1)
const resumo = ref<ResumoVendasApi | null>(null)
const carregando = ref(true)
const erro = ref('')
const ficha = ref<VendaApi | null>(null)

let pedido = 0
async function carregar(mais = false) {
  const meu = ++pedido
  carregando.value = true
  erro.value = ''
  try {
    const p = mais ? pagina.value + 1 : 1
    const r = await vendasApi.listar(sessao.value, { status: filtro.value, pagina: p, limite: 20 })
    if (meu !== pedido) return
    vendas.value = mais ? [...vendas.value, ...r.itens] : r.itens
    total.value = r.total
    pagina.value = p
  } catch (e) {
    if (meu === pedido) erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar as vendas.'
  } finally {
    if (meu === pedido) carregando.value = false
  }
}
async function carregarResumo() {
  try { resumo.value = await vendasApi.resumo(sessao.value) } catch { /* os números ficam em branco */ }
}
watch(filtro, () => carregar())
onMounted(async () => {
  carregar(); carregarResumo()
  // /operacoes?venda=ID abre a ficha (é para onde a "venda feita" manda)
  const id = Number(route.query.venda)
  if (id) ficha.value = await vendasApi.obter(sessao.value, id).catch(() => null)
})

const filtrosIphone = [{ id: 'ATIVA', label: 'Em andamento' }, { id: 'ATRASO', label: 'Com atraso' }, { id: 'QUITADA', label: 'Quitadas' }, { id: 'RETOMADA', label: 'Retomadas' }]

// ---- Empréstimos: ainda com dados de exemplo (módulo próprio vem depois) ----
const filtroEmp = ref('ATIVA')
const emps = computed(() => (d.value?.emprestimos ?? []).map((o: Operacao) => ({ o, k: contas(o) })))
const empsAtivos = computed(() => emps.value.filter(({ k }) => k.status === 'ATIVA'))
const listaEmp = computed(() =>
  emps.value.filter(({ k }) => (filtroEmp.value === 'ATRASO' ? k.status === 'ATIVA' && k.atrasadas.length : k.status === filtroEmp.value)).sort((a, b) => b.o.data.localeCompare(a.o.data)),
)
const filtrosEmp = computed(() => [{ id: 'ATIVA', label: 'Em andamento' }, { id: 'ATRASO', label: `Com atraso · ${empsAtivos.value.filter(({ k }) => k.atrasadas.length).length}` }, { id: 'QUITADA', label: 'Quitados' }])
const empAReceber = computed(() => empsAtivos.value.reduce((s, { k }) => s + k.falta, 0))
const empCapital = computed(() => empsAtivos.value.reduce((s, { k }) => s + (k.inv - k.capitalDeVolta), 0))
const empLucro = computed(() => empsAtivos.value.reduce((s, { k }) => s + Math.max(0, k.seuLucro - k.lucroRealizado), 0))

// só o admin tem empréstimos; o vendedor só vê as vendas dele
const abas = computed(() => [
  { id: 'iphone', label: 'iPhones', icon: 'smartphone', n: resumo.value ? undefined : undefined },
  ...(ehAdmin.value ? [{ id: 'emp', label: 'Empréstimos', icon: 'landmark', n: empsAtivos.value.length }] : []),
])
</script>

<template>
  <Abas v-if="ehAdmin" v-model="aba" :itens="abas" />

  <template v-if="aba === 'iphone'">
    <div class="resumo3">
      <div><div class="lbl">A receber</div><div class="val num">{{ resumo ? fmt0(resumo.aReceber) : '—' }}</div></div>
      <template v-if="ehAdmin">
        <div><div class="lbl">Capital na rua</div><div class="val num">{{ resumo ? fmt0(resumo.capitalNaRua ?? 0) : '—' }}</div></div>
        <div><div class="lbl">Lucro por vir</div><div class="val num" style="color: var(--ok)">{{ resumo ? fmt0(resumo.lucroPorVir ?? 0) : '—' }}</div></div>
      </template>
    </div>
    <Seg v-model="filtro" :itens="filtrosIphone" />
    <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar()">Tentar de novo</button></div>
    <div class="fones">
      <VendaCard v-for="v in vendas" :key="v.id" :v="v" @abrir="ficha = $event" />
      <div v-if="!vendas.length && !carregando && !erro" class="card empty">Nenhuma venda aqui.</div>
      <div v-if="carregando && !vendas.length" class="card empty">Carregando…</div>
    </div>
    <button v-if="vendas.length < total" class="btn b-out" :disabled="carregando" @click="carregar(true)">{{ carregando ? 'Carregando…' : 'Carregar mais' }}</button>
  </template>

  <template v-else>
    <div class="resumo3">
      <div><div class="lbl">A receber</div><div class="val num">{{ fmt0(empAReceber) }}</div></div>
      <div><div class="lbl">Capital na rua</div><div class="val num">{{ fmt0(empCapital) }}</div></div>
      <div><div class="lbl">Lucro por vir</div><div class="val num" style="color: var(--ok)">{{ fmt0(empLucro) }}</div></div>
    </div>
    <Seg v-model="filtroEmp" :itens="filtrosEmp" />
    <div class="fones">
      <OperacaoCard v-for="{ o, k } in listaEmp" :key="o.id" :o="o" :k="k" />
      <div v-if="!listaEmp.length" class="card empty">Nenhum empréstimo aqui.</div>
    </div>
  </template>

  <VendaFicha :venda="ficha" @fechar="ficha = null" />
</template>
