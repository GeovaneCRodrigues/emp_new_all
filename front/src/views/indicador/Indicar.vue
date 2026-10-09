<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ErroApi, type ClienteApi, type SalvoCliente } from '@/api/clientes'
import type { PropostaApi, StatusProposta } from '@/api/propostas'
import { clientesApi, propostasApi } from '@/api/recursos'
import ClienteForm from '@/components/ClienteForm.vue'
import Icon from '@/components/Icon.vue'
import PropostaForm from '@/components/PropostaForm.vue'
import Sheet from '@/components/Sheet.vue'
import { useApp } from '@/composables/useApp'
import { useToast } from '@/composables/useToast'
import { mascaraFone } from '@/domain/documentos'
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

// ---- escolher o cliente (ou cadastrar um novo) ----
const escolhendo = ref(false)
const busca = ref('')
const meus = ref<ClienteApi[]>([])
const cadastrando = ref(false)
const clienteDaProposta = ref<ClienteApi | null>(null)
const propostaAberta = computed(() => clienteDaProposta.value !== null)

async function buscar() {
  const r = await clientesApi.listar(sessao.value, { busca: busca.value.trim() || undefined, limite: 20 }).catch(() => null)
  if (r) meus.value = r.itens
}
let espera: ReturnType<typeof setTimeout> | undefined
watch(busca, () => { clearTimeout(espera); espera = setTimeout(buscar, 300) })
function abrirEscolha() { escolhendo.value = true; busca.value = ''; buscar() }
function escolher(c: ClienteApi) { escolhendo.value = false; clienteDaProposta.value = c }
function aoCadastrar(r: SalvoCliente) {
  cadastrando.value = false; escolhendo.value = false
  mostrar(`${r.cliente.nome} cadastrado. Agora diga o que ele quer.`)
  clienteDaProposta.value = r.cliente
}
function aoEnviar(p: PropostaApi) {
  clienteDaProposta.value = null
  mostrar(`Proposta de ${p.cliente.nome} enviada para a loja.`)
  carregar()
}
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

  <!-- escolher o cliente -->
  <Sheet :aberto="escolhendo" @fechar="escolhendo = false">
    <h3>Indicar para quem?</h3>
    <div class="field" style="margin-top: 12px"><div class="inp"><input v-model="busca" placeholder="Buscar pelo nome" aria-label="Buscar cliente" autocomplete="off" /></div></div>
    <div class="list card" style="margin-top: 10px" data-testid="escolher-cliente">
      <button v-for="c in meus" :key="c.id" class="li" :data-cliente="c.id" @click="escolher(c)">
        <span class="ini">{{ iniciais(c.nome) }}</span>
        <div class="mid"><div class="t">{{ c.nome }}</div><div class="s">{{ mascaraFone(c.fone) }}</div></div>
      </button>
      <div v-if="!meus.length" class="empty">Nenhum cliente seu com esse nome.</div>
    </div>
    <button class="btn b-out b-block" style="margin-top: 12px" data-testid="cadastrar-novo" @click="cadastrando = true"><Icon name="plus" small />Cadastrar um cliente novo</button>
  </Sheet>

  <ClienteForm :aberto="cadastrando" :cliente="null" @fechar="cadastrando = false" @salvo="aoCadastrar" />
  <PropostaForm :aberto="propostaAberta" :cliente="clienteDaProposta" @fechar="clienteDaProposta = null" @enviada="aoEnviar" />
</template>
