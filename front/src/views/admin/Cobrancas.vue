<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { AbaCobranca, CobrancaApi, ListaCobrancasApi } from '@/api/recebimentos'
import { recebimentosApi, vendasApi } from '@/api/recursos'
import type { VendaApi } from '@/api/vendas'
import CobrancaLinha from '@/components/CobrancaLinha.vue'
import RecebimentoFluxo from '@/components/RecebimentoFluxo.vue'
import Seg from '@/components/Seg.vue'
import VendaFicha from '@/components/VendaFicha.vue'
import { useApp } from '@/composables/useApp'
import { useAtrasadas } from '@/composables/useAtrasadas'
import { fmt } from '@/domain/format'

const { sessao } = useApp()
const { atualizar } = useAtrasadas()

const aba = ref<AbaCobranca>('atrasadas')
const itens = ref<CobrancaApi[]>([])
const total = ref(0)
const valorTotal = ref(0)
const pagina = ref(1)
const contagens = ref<ListaCobrancasApi['contagens']>({ atrasadas: 0, hoje: 0, proximas: 0 })
const carregando = ref(true)
const erro = ref('')
const ficha = ref<VendaApi | null>(null)
const fluxo = ref<InstanceType<typeof RecebimentoFluxo> | null>(null)

let pedido = 0
async function carregar(mais = false) {
  const meu = ++pedido
  carregando.value = true
  erro.value = ''
  try {
    const p = mais ? pagina.value + 1 : 1
    const r = await recebimentosApi.cobrancas(sessao.value, { aba: aba.value, pagina: p, limite: 20 })
    if (meu !== pedido) return
    itens.value = mais ? [...itens.value, ...r.itens] : r.itens
    total.value = r.total; valorTotal.value = r.valorTotal; contagens.value = r.contagens; pagina.value = p
  } catch (e) {
    if (meu === pedido) erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar as cobranças.'
  } finally {
    if (meu === pedido) carregando.value = false
  }
}
watch(aba, () => carregar())
onMounted(() => { carregar(); atualizar(sessao.value) })

const abas = computed(() => [
  { id: 'atrasadas', label: 'Atrasadas' + (contagens.value.atrasadas ? ` · ${contagens.value.atrasadas}` : '') },
  { id: 'hoje', label: 'Esta semana' + (contagens.value.hoje ? ` · ${contagens.value.hoje}` : '') },
  { id: 'proximas', label: 'Próximas' + (contagens.value.proximas ? ` · ${contagens.value.proximas}` : '') },
  { id: 'recebidas', label: 'Recebidas' },
])
const legenda = computed(() => ({ atrasadas: 'em atraso', hoje: 'vence nos próximos 7 dias', proximas: 'nos próximos 45 dias', recebidas: 'nos últimos 30 dias' })[aba.value])

async function abrirFicha(c: CobrancaApi) { ficha.value = await vendasApi.obter(sessao.value, c.vendaId).catch(() => null) }
const receber = (c: CobrancaApi) => fluxo.value?.iniciar(c.vendaId, c.parcela)
const verRecibo = (id: number) => fluxo.value?.abrirRecibo(id)
</script>

<template>
  <Seg v-model="aba as string" :itens="abas" />
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar()">Tentar de novo</button></div>
  <div class="card">
    <div class="totbar">
      <span class="small">{{ total }} {{ total === 1 ? 'parcela' : 'parcelas' }} {{ legenda }}</span>
      <b class="num" data-testid="cobrancas-total" style="font-size: 16px" :style="{ color: aba === 'atrasadas' ? 'var(--bad)' : aba === 'recebidas' ? 'var(--ok)' : 'var(--strong)' }">{{ fmt(valorTotal) }}</b>
    </div>
    <div class="list">
      <CobrancaLinha v-for="c in itens" :key="c.vendaId + '-' + c.parcela" :c="c" :recebida="aba === 'recebidas'" @abrir="abrirFicha" @receber="receber" @recibo="verRecibo" />
      <div v-if="!itens.length && !carregando && !erro" class="empty">Nada aqui.</div>
      <div v-if="carregando && !itens.length" class="empty">Carregando…</div>
    </div>
  </div>
  <button v-if="itens.length < total" class="btn b-out" :disabled="carregando" @click="carregar(true)">{{ carregando ? 'Carregando…' : 'Carregar mais' }}</button>

  <VendaFicha :venda="ficha" @fechar="ficha = null" @receber="(p) => ficha && fluxo?.iniciar(ficha.id, p)" @recibo="verRecibo" @desfazer="(id) => fluxo?.desfazer(id)" />
  <RecebimentoFluxo ref="fluxo" @mudou="carregar()" />
</template>
