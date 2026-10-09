<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { PropostaApi, StatusProposta } from '@/api/propostas'
import { propostasApi } from '@/api/recursos'
import Icon from '@/components/Icon.vue'
import IndicarFluxo from '@/components/IndicarFluxo.vue'
import { useApp } from '@/composables/useApp'
import { useToast } from '@/composables/useToast'
import { dmyA, fmt, iniciais } from '@/domain/format'

/** O indicador manda o cliente e o que ele quer; acompanha o que a loja respondeu. */
const { sessao } = useApp()
const { mostrar } = useToast()

const propostas = ref<PropostaApi[]>([])
const carregando = ref(true)
const erro = ref('')
const ocupado = ref<number | null>(null)

async function carregar() {
  erro.value = ''
  try { propostas.value = (await propostasApi.listar(sessao.value, { limite: 100 })).itens }
  catch (e) { erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar as propostas.' }
  finally { carregando.value = false }
}
onMounted(carregar)

const fluxo = ref<InstanceType<typeof IndicarFluxo> | null>(null)
const abrirEscolha = () => fluxo.value?.abrir()

async function cancelar(p: PropostaApi) {
  if (ocupado.value) return
  ocupado.value = p.id
  try { await propostasApi.cancelar(sessao.value, p.id); mostrar('Proposta cancelada.') }
  catch (e) { mostrar(e instanceof ErroApi ? e.message : 'Não consegui cancelar.') }
  finally { ocupado.value = null; await carregar() }
}

const ROTULO: Record<StatusProposta, string> = { PENDENTE: 'esperando a loja', ACEITA: 'aceita', RECUSADA: 'recusada', CANCELADA: 'cancelada' }
const CHIP: Record<StatusProposta, string> = { PENDENTE: 'c-warn', ACEITA: 'c-ok', RECUSADA: 'c-bad', CANCELADA: 'c-neu' }
const resumo = (p: PropostaApi) => [p.tipo === 'VENDA' ? 'Venda' : 'Empréstimo', p.interesse, p.valor ? fmt(p.valor) : null, p.parcelas ? `${p.parcelas}x` : null].filter(Boolean).join(' · ')
const pendentes = computed(() => propostas.value.filter((p) => p.status === 'PENDENTE').length)
</script>

<template>
  <div class="row" style="justify-content: space-between; gap: 12px">
    <p class="small" style="margin: 0; flex: 1">Cadastre o cliente e diga o que ele quer. A loja analisa e lança a venda ou o empréstimo no seu nome.</p>
    <button class="btn b-pri b-sm" data-testid="nova-proposta" @click="abrirEscolha"><Icon name="plus" small />Indicar cliente</button>
  </div>

  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar">Tentar de novo</button></div>

  <div class="sec-t"><h2>Minhas propostas <span v-if="pendentes" class="chip c-warn">{{ pendentes }} esperando</span></h2></div>
  <div class="card list" data-testid="minhas-propostas">
    <div v-for="p in propostas" :key="p.id" class="li" :data-proposta="p.id" style="cursor: default; align-items: flex-start">
      <span class="ini">{{ iniciais(p.cliente.nome) }}</span>
      <div class="mid">
        <div class="t">{{ p.cliente.nome }}</div>
        <div class="s">{{ resumo(p) }}</div>
        <div class="s">enviada em {{ dmyA(p.criadaEm.slice(0, 10)) }}</div>
        <div v-if="p.status === 'RECUSADA' && p.motivoRecusa" class="s" style="color: var(--bad)">“{{ p.motivoRecusa }}”</div>
        <div v-if="p.status === 'ACEITA' && p.operacao" class="s" style="color: var(--ok)">{{ p.operacao.tipo === 'VENDA' ? 'venda cadastrada pela loja' : 'empréstimo cadastrado pela loja' }}</div>
      </div>
      <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px">
        <span class="chip" :class="CHIP[p.status]" data-status>{{ ROTULO[p.status] }}</span>
        <button v-if="p.status === 'PENDENTE'" class="btn b-ghost b-sm" :disabled="ocupado === p.id" data-cancelar @click="cancelar(p)">Cancelar</button>
      </div>
    </div>
    <div v-if="!propostas.length && !carregando" class="empty">Nenhuma proposta ainda. Toque em “Indicar cliente”.</div>
  </div>

  <IndicarFluxo ref="fluxo" @enviada="carregar" />
</template>
