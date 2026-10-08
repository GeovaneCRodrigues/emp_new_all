<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ErroApi } from '@/api/clientes'
import type { AparelhoApi, EstadoAparelho, ResumoEstoqueApi } from '@/api/estoque'
import { investidoApi } from '@/api/estoque'
import { estoqueApi } from '@/api/recursos'
import AparelhoForm from '@/components/AparelhoForm.vue'
import Icon from '@/components/Icon.vue'
import Seg from '@/components/Seg.vue'
import Sheet from '@/components/Sheet.vue'
import { CORES } from '@/data/cores'
import { useApp } from '@/composables/useApp'
import { diasEntre } from '@/domain/datas'
import { dmyA, fmt, fmt0 } from '@/domain/format'

const router = useRouter()
const { sessao, hoje } = useApp()

const ehAdmin = computed(() => sessao.value.perfil === 'ADMIN')
const filtro = ref<EstadoAparelho>('DISPONIVEL')
const busca = ref('')
const itens = ref<AparelhoApi[]>([])
const total = ref(0)
const pagina = ref(1)
const resumo = ref<ResumoEstoqueApi | null>(null)
const carregando = ref(true)
const erro = ref('')
const ficha = ref<AparelhoApi | null>(null)
const formAberto = ref(false)
const editando = ref<AparelhoApi | null>(null)

let pedido = 0
async function carregar(mais = false) {
  const meu = ++pedido
  carregando.value = true
  erro.value = ''
  try {
    const p = mais ? pagina.value + 1 : 1
    const r = await estoqueApi.listar(sessao.value, { busca: busca.value.trim() || undefined, estado: filtro.value, pagina: p, limite: 20 })
    if (meu !== pedido) return
    itens.value = mais ? [...itens.value, ...r.itens] : r.itens
    total.value = r.total
    pagina.value = p
  } catch (e) {
    if (meu === pedido) erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar o estoque.'
  } finally {
    if (meu === pedido) carregando.value = false
  }
}
async function carregarResumo() {
  try { resumo.value = await estoqueApi.resumo(sessao.value) } catch { /* os números ficam em branco */ }
}

let espera: ReturnType<typeof setTimeout> | undefined
watch(busca, () => { clearTimeout(espera); espera = setTimeout(() => carregar(), 300) })
watch(filtro, () => carregar())
onBeforeUnmount(() => clearTimeout(espera))
onMounted(() => { carregar(); carregarResumo() })

const filtros = computed(() => {
  const r = resumo.value
  const base = [{ id: 'DISPONIVEL', label: `Disponível${r ? ` · ${r.disponiveis}` : ''}` }, { id: 'ENCOMENDADO', label: `Encomendado${r ? ` · ${r.encomendados}` : ''}` }]
  // o vendedor só vê o que está à venda
  return ehAdmin.value ? [...base, { id: 'VENDIDO', label: 'Vendidos' }] : base
})
const dias = (a: AparelhoApi) => diasEntre(a.dataCompra, hoje.value)
const corBateria = (n: number) => (n >= 90 ? 'var(--ok)' : n >= 85 ? 'var(--soft)' : 'var(--warn)')
const lucro = (a: AparelhoApi) => a.preco - investidoApi(a)

function novo() { editando.value = null; formAberto.value = true }
function editar(a: AparelhoApi) { editando.value = a; ficha.value = null; formAberto.value = true }
async function aoSalvar() { formAberto.value = false; await Promise.all([carregar(), carregarResumo()]) }
const simular = (a: AparelhoApi) => { ficha.value = null; router.push('/simulador?bem=' + a.id) }
</script>

<template>
  <div class="resumo3">
    <div><div class="lbl">Disponível</div><div class="val num">{{ resumo?.disponiveis ?? '—' }} aparelhos</div></div>
    <template v-if="ehAdmin">
      <div><div class="lbl">Capital parado</div><div class="val num">{{ resumo ? fmt0(resumo.capitalParado ?? 0) : '—' }}</div></div>
      <div><div class="lbl">Margem média</div><div class="val num" style="color: var(--ok)">{{ resumo ? Math.round((resumo.margemMedia ?? 0) * 100) + '%' : '—' }}</div></div>
    </template>
    <template v-else>
      <div><div class="lbl">Encomendados</div><div class="val num">{{ resumo?.encomendados ?? '—' }}</div></div>
      <div><div class="lbl">Valor em vitrine</div><div class="val num">{{ resumo ? fmt0(resumo.valorEmVitrine) : '—' }}</div></div>
    </template>
  </div>

  <div class="row" style="gap: 8px">
    <label class="busca" style="flex: 1"><Icon name="search" small /><input v-model="busca" placeholder="Modelo, cor ou IMEI" aria-label="Buscar aparelho" /></label>
    <button v-if="ehAdmin" class="btn b-pri" @click="novo"><Icon name="plus" small />Aparelho</button>
  </div>
  <Seg v-model="filtro" :itens="filtros" />

  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar()">Tentar de novo</button></div>

  <div class="fones">
    <button v-for="b in itens" :key="b.id" class="card fone" @click="ficha = b">
      <span class="pic"><Icon name="smartphone" /><span class="cor" :style="{ background: CORES[b.cor] || '#999' }"></span></span>
      <span class="info">
        <span class="nome">
          <span>{{ b.modelo }} · {{ b.gb }} GB</span>
          <span v-if="b.estado === 'DISPONIVEL'" class="chip" :class="dias(b) > 30 ? 'c-warn' : 'c-neu'">{{ dias(b) }}d</span>
          <span v-else-if="b.estado === 'ENCOMENDADO'" class="chip c-gold">encomenda</span>
          <span v-else class="chip c-neu">vendido</span>
        </span>
        <span class="specs">
          <span>{{ b.cor }}</span><span>{{ b.condicao }}</span>
          <span :style="{ color: corBateria(b.bateria) }"><Icon name="battery-medium" small />{{ b.bateria }}%</span>
          <span v-if="b.origem === 'TROCA'">veio de troca</span>
          <span v-if="b.imei" class="mono">•••{{ b.imei.slice(-4) }}</span>
        </span>
        <span v-if="b.paraCliente" class="small">Para {{ b.paraCliente.nome }}</span>
        <span class="precos">
          <b class="num" style="color: var(--strong); font-size: 16px">{{ fmt0(b.preco) }}</b>
          <span v-if="b.custo !== undefined" class="small num">custo {{ fmt0(investidoApi(b)) }} · <span :style="{ color: lucro(b) >= 0 ? 'var(--ok)' : 'var(--bad)', fontWeight: 600 }">lucro {{ fmt0(lucro(b)) }}</span></span>
        </span>
      </span>
    </button>
    <div v-if="!itens.length && !carregando && !erro" class="card empty">{{ busca.trim() ? 'Nada encontrado.' : 'Nada por aqui.' }}</div>
    <div v-if="carregando && !itens.length" class="card empty">Carregando…</div>
  </div>
  <button v-if="itens.length < total" class="btn b-out" :disabled="carregando" @click="carregar(true)">{{ carregando ? 'Carregando…' : 'Carregar mais' }}</button>

  <Sheet :aberto="ficha !== null" @fechar="ficha = null">
    <template v-if="ficha">
      <h3>{{ ficha.modelo }} · {{ ficha.gb }} GB</h3>
      <div class="small">{{ ficha.cor }} · {{ ficha.condicao }}<template v-if="ficha.estado === 'ENCOMENDADO'"> · encomendado</template><template v-else-if="ficha.estado === 'VENDIDO'"> · vendido</template></div>
      <div class="dl card pad" style="margin-top: 12px">
        <div><div class="lbl">Preço de venda</div><div class="val num">{{ fmt(ficha.preco) }}</div></div>
        <div><div class="lbl">Bateria</div><div class="val num">{{ ficha.bateria }}%</div></div>
        <template v-if="ficha.custo !== undefined">
          <div><div class="lbl">Custo + extras</div><div class="val num">{{ fmt(investidoApi(ficha)) }}</div></div>
          <div><div class="lbl">Lucro previsto</div><div class="val num" :style="{ color: lucro(ficha) >= 0 ? 'var(--ok)' : 'var(--bad)' }">{{ fmt(lucro(ficha)) }}</div></div>
        </template>
        <div><div class="lbl">IMEI</div><div class="val mono">{{ ficha.imei ?? '—' }}</div></div>
        <div><div class="lbl">Comprado em</div><div class="val">{{ dmyA(ficha.dataCompra) }}<template v-if="ficha.origem === 'TROCA'"> (troca)</template></div></div>
        <div v-if="ficha.paraCliente" style="grid-column: 1 / -1"><div class="lbl">Encomendado por</div><div class="val">{{ ficha.paraCliente.nome }}</div></div>
        <div v-if="ficha.observacoes" style="grid-column: 1 / -1"><div class="lbl">Observações</div><div class="val">{{ ficha.observacoes }}</div></div>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap">
        <button v-if="ficha.estado !== 'VENDIDO'" class="btn b-out" style="flex: 1" @click="simular(ficha)"><Icon name="calculator" small />Simular</button>
        <button v-if="ficha.estado === 'DISPONIVEL'" class="btn b-pri" style="flex: 1" @click="router.push('/vender')"><Icon name="plus" small />Vender</button>
        <button v-if="ehAdmin && ficha.estado !== 'VENDIDO'" class="btn b-sub" style="flex-basis: 100%" @click="editar(ficha)">Editar aparelho</button>
      </div>
      <div v-if="ficha.estado === 'VENDIDO'" class="small" style="margin-top: 8px">Aparelho vendido não pode ser alterado.</div>
    </template>
  </Sheet>

  <AparelhoForm :aberto="formAberto" :aparelho="editando" @fechar="formAberto = false" @salvo="aoSalvar" />
</template>
