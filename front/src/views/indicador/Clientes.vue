<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ErroApi, type ClienteApi } from '@/api/clientes'
import type { EmprestimoApi } from '@/api/emprestimos'
import { todasAsPaginas } from '@/api/paginar'
import { clientesApi, emprestimosApi, vendasApi } from '@/api/recursos'
import type { VendaApi } from '@/api/vendas'
import Icon from '@/components/Icon.vue'
import IndicarFluxo from '@/components/IndicarFluxo.vue'
import Seg from '@/components/Seg.vue'
import Sheet from '@/components/Sheet.vue'
import { useApp } from '@/composables/useApp'
import { exibirFone } from '@/domain/documentos'
import { fmt, fmt0, iniciais } from '@/domain/format'

/** Os clientes do indicador (os que ele cadastrou e os que têm venda ou empréstimo com ele), com o que cada um deve e a parte dele. */
const { sessao } = useApp()
const clientes = ref<ClienteApi[]>([])
const vendas = ref<VendaApi[]>([])
const emps = ref<EmprestimoApi[]>([])
const carregando = ref(true)
const erro = ref('')
const busca = ref('')
const filtro = ref('todos')
const ficha = ref<ClienteApi | null>(null)
const fluxo = ref<InstanceType<typeof IndicarFluxo> | null>(null)

async function carregar() {
  try {
    const s = sessao.value
    ;[clientes.value, vendas.value, emps.value] = await Promise.all([
      todasAsPaginas((p) => clientesApi.listar(s, { pagina: p, limite: 100 })),
      todasAsPaginas((p) => vendasApi.listar(s, { pagina: p, limite: 100 })),
      todasAsPaginas((p) => emprestimosApi.listar(s, { pagina: p, limite: 100 })),
    ])
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar os clientes.'
  } finally {
    carregando.value = false
  }
}
onMounted(carregar)

interface Linha { c: ClienteApi; nVendas: number; nEmps: number; deve: number; atrasadas: number; suaParte: number }
const linhas = computed<Linha[]>(() => clientes.value.map((c) => {
  const v = vendas.value.filter((x) => x.cliente.id === c.id && x.status !== 'CANCELADA')
  const e = emps.value.filter((x) => x.cliente.id === c.id && x.status !== 'CANCELADA')
  const ativos = [...v, ...e].filter((o) => o.status === 'ATIVA')
  return {
    c, nVendas: v.length, nEmps: e.length,
    deve: Math.round(ativos.reduce((x, o) => x + o.falta, 0) * 100) / 100, atrasadas: ativos.reduce((x, o) => x + o.atrasadas, 0),
    suaParte: Math.round([...v, ...e].reduce((x, o) => x + (o.suaParte ?? 0), 0) * 100) / 100,
  }
}))
const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const visiveis = computed(() => linhas.value.filter((l) => {
  if (busca.value.trim() && !semAcento(l.c.nome).includes(semAcento(busca.value.trim()))) return false
  if (filtro.value === 'atrasados') return l.atrasadas > 0
  if (filtro.value === 'emdia') return l.atrasadas === 0
  return true
}))
const filtros = computed(() => [
  { id: 'todos', label: `Todos · ${linhas.value.length}` },
  { id: 'atrasados', label: `Atrasados · ${linhas.value.filter((l) => l.atrasadas > 0).length}` },
  { id: 'emdia', label: `Em dia · ${linhas.value.filter((l) => l.atrasadas === 0).length}` },
])
const resumoLinha = (l: Linha) => {
  const p: string[] = []
  if (l.nVendas) p.push(`${l.nVendas} iPhone${l.nVendas > 1 ? 's' : ''}`)
  if (l.nEmps) p.push(`${l.nEmps} empréstimo${l.nEmps > 1 ? 's' : ''}`)
  if (!p.length) p.push('só cadastrado')
  if (l.suaParte > 0) p.push(`sua parte ${fmt0(l.suaParte)}`)
  return p.join(' · ')
}
const linhaDe = (c: ClienteApi) => linhas.value.find((l) => l.c.id === c.id)
const opsDe = (c: ClienteApi) => [
  ...vendas.value.filter((v) => v.cliente.id === c.id).map((v) => ({ chave: 'V' + v.id, titulo: `${v.aparelho.modelo} ${v.aparelho.gb} GB`, status: v.status, atrasadas: v.atrasadas, falta: v.falta, suaParte: v.suaParte ?? 0 })),
  ...emps.value.filter((e) => e.cliente.id === c.id).map((e) => ({ chave: 'E' + e.id, titulo: e.modalidade === 'JUROS' ? 'Empréstimo só juros' : e.modalidade === 'DIARIA' ? 'Empréstimo diário' : 'Empréstimo parcelado', status: e.status, atrasadas: e.atrasadas, falta: e.falta, suaParte: e.suaParte ?? 0 })),
]
const rotuloOp = (o: { status: string; atrasadas: number }) => (o.status === 'QUITADA' ? 'quitada' : o.status === 'RETOMADA' ? 'retomada' : o.status === 'CANCELADA' ? 'cancelada' : o.atrasadas > 0 ? `${o.atrasadas} atrasada${o.atrasadas > 1 ? 's' : ''}` : 'em dia')
const propor = (c: ClienteApi) => { ficha.value = null; fluxo.value?.abrir({ cliente: c }) }
</script>

<template>
  <div class="row" style="justify-content: space-between; gap: 12px">
    <p class="small" style="margin: 0; flex: 1">Os clientes que você trouxe, com o que cada um ainda deve e a sua parte.</p>
    <button class="btn b-pri b-sm" data-testid="indicar-cliente" @click="fluxo?.abrir()"><Icon name="plus" small />Indicar cliente</button>
  </div>
  <div class="field" style="margin-top: 12px"><div class="inp"><Icon name="search" small /><input v-model="busca" placeholder="Buscar pelo nome" aria-label="Buscar pelo nome" autocomplete="off" /></div></div>
  <Seg v-model="filtro" :itens="filtros" />
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
  <div class="card list" data-testid="meus-clientes">
    <button v-for="l in visiveis" :key="l.c.id" class="li" :data-cliente="l.c.id" @click="ficha = l.c">
      <span class="ini">{{ iniciais(l.c.nome) }}</span>
      <div class="mid"><div class="t">{{ l.c.nome }}</div><div class="s">{{ resumoLinha(l) }}</div></div>
      <div style="text-align: right">
        <b v-if="l.deve > 0" class="num">{{ fmt0(l.deve) }}</b>
        <div><span class="chip" :class="l.atrasadas > 0 ? 'c-bad' : 'c-ok'" data-status>{{ l.atrasadas > 0 ? `${l.atrasadas} atrasada${l.atrasadas > 1 ? 's' : ''}` : 'em dia' }}</span></div>
      </div>
    </button>
    <div v-if="!visiveis.length && !carregando && !erro" class="empty">{{ clientes.length ? 'Nenhum cliente nesse filtro.' : 'Você ainda não tem clientes. Toque em “Indicar cliente”.' }}</div>
    <div v-if="carregando" class="empty">Carregando…</div>
  </div>

  <Sheet :aberto="ficha !== null" @fechar="ficha = null">
    <template v-if="ficha">
      <div class="row" style="gap: 12px"><span class="ini">{{ iniciais(ficha.nome) }}</span><div style="flex: 1; min-width: 0"><h3>{{ ficha.nome }}</h3><div class="small">{{ exibirFone(ficha.fone) }}</div></div></div>
      <div class="dl card pad" style="margin-top: 14px">
        <div><div class="lbl">Ainda deve</div><div class="val num">{{ fmt(linhaDe(ficha)?.deve ?? 0) }}</div></div>
        <div><div class="lbl">Sua parte</div><div class="val num">{{ fmt(linhaDe(ficha)?.suaParte ?? 0) }}</div></div>
      </div>
      <div v-if="opsDe(ficha).length" class="list card" style="margin-top: 12px">
        <div v-for="o in opsDe(ficha)" :key="o.chave" class="li" style="cursor: default">
          <div class="mid"><div class="t">{{ o.titulo }}</div><div class="s">deve {{ fmt(o.falta) }} · sua parte {{ fmt(o.suaParte) }}</div></div>
          <span class="chip" :class="o.status === 'ATIVA' && o.atrasadas > 0 ? 'c-bad' : 'c-ok'">{{ rotuloOp(o) }}</span>
        </div>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap">
        <a v-if="ficha.fone" class="btn b-out" style="flex: 1" :href="`https://wa.me/55${ficha.fone}`" target="_blank" rel="noopener"><Icon name="message-circle" small />WhatsApp</a>
        <button class="btn b-pri" style="flex: 1" data-propor @click="propor(ficha)">Mandar proposta</button>
      </div>
    </template>
  </Sheet>
  <IndicarFluxo ref="fluxo" @enviada="carregar" />
</template>
