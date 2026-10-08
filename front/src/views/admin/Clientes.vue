<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ErroApi, type ClienteApi, type Responsavel, type SalvoCliente } from '@/api/clientes'
import { clientesApi } from '@/api/recursos'
import ClienteForm from '@/components/ClienteForm.vue'
import Icon from '@/components/Icon.vue'
import OperacaoCard from '@/components/OperacaoCard.vue'
import Sheet from '@/components/Sheet.vue'
import { modoDemo } from '@/composables/useAuth'
import { useApp } from '@/composables/useApp'
import { dmyA, iniciais } from '@/domain/format'
import { mascaraCpf, mascaraFone } from '@/domain/documentos'

const { sessao, operacoes, contas } = useApp()

const podeEditar = computed(() => sessao.value.perfil === 'ADMIN' || sessao.value.perfil === 'VENDEDOR')
const veDocumentos = computed(() => sessao.value.perfil !== 'INDICADOR')

const itens = ref<ClienteApi[]>([])
const total = ref(0)
const pagina = ref(1)
const busca = ref('')
const carregando = ref(false)
const erro = ref('')
const aviso = ref('')
const responsaveis = ref<Responsavel[]>([])

const ficha = ref<ClienteApi | null>(null)
const formAberto = ref(false)
const editando = ref<ClienteApi | null>(null)

// uma busca nova vale mais que uma resposta antiga que chegou atrasada
let pedido = 0
async function carregar(mais = false) {
  const meu = ++pedido
  carregando.value = true
  erro.value = ''
  try {
    const p = mais ? pagina.value + 1 : 1
    const r = await clientesApi.listar(sessao.value, { busca: busca.value.trim() || undefined, pagina: p, limite: 20 })
    if (meu !== pedido) return
    itens.value = mais ? [...itens.value, ...r.itens] : r.itens
    total.value = r.total
    pagina.value = p
  } catch (e) {
    if (meu === pedido) erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar os clientes.'
  } finally {
    if (meu === pedido) carregando.value = false
  }
}

let espera: ReturnType<typeof setTimeout> | undefined
watch(busca, () => { clearTimeout(espera); espera = setTimeout(() => carregar(), 300) })
onBeforeUnmount(() => clearTimeout(espera))

onMounted(async () => {
  carregar()
  if (sessao.value.perfil === 'ADMIN') responsaveis.value = await clientesApi.responsaveis(sessao.value).catch(() => [])
})

const nomeResponsavel = (id?: number | null) => responsaveis.value.find((u) => u.id === id)?.nome ?? null
const temMais = computed(() => itens.value.length < total.value)

function novo() { editando.value = null; formAberto.value = true }
function editar(c: ClienteApi) { editando.value = c; ficha.value = null; formAberto.value = true }
function aoSalvar(r: SalvoCliente) {
  formAberto.value = false
  aviso.value = r.avisos.length ? `Cliente salvo. Atenção: ${r.avisos.join(' ')}` : ''
  carregar()
}

const opsDoCliente = computed(() => (ficha.value ? operacoes.value.filter((o) => o.clienteId === ficha.value!.id) : []))
const linkZap = (fone: string) => `https://wa.me/55${fone}`
</script>

<template>
  <div class="row" style="gap: 8px">
    <label class="busca" style="flex: 1"><Icon name="search" small /><input v-model="busca" placeholder="Nome, telefone ou CPF" aria-label="Buscar cliente" /></label>
    <button v-if="podeEditar" class="btn b-pri" @click="novo"><Icon name="plus" small />Cliente</button>
  </div>

  <div v-if="aviso" class="aviso" role="status" style="justify-content: space-between">
    <span>{{ aviso }}</span><button class="btn b-ghost b-sm" @click="aviso = ''">Ok</button>
  </div>
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between">
    <span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar()">Tentar de novo</button>
  </div>

  <div class="small">{{ total }} {{ total === 1 ? 'cliente' : 'clientes' }}{{ busca.trim() ? ' na busca' : '' }}</div>

  <div class="card list">
    <button v-for="c in itens" :key="c.id" class="li" @click="ficha = c">
      <span class="ini">{{ iniciais(c.nome) }}</span>
      <div class="mid">
        <div class="t">{{ c.nome }}</div>
        <div class="s">{{ mascaraFone(c.fone) }}<template v-if="nomeResponsavel(c.responsavelId)"> · {{ nomeResponsavel(c.responsavelId) }}</template></div>
      </div>
      <span v-if="veDocumentos && !c.cpf" class="chip c-neu">sem CPF</span>
    </button>
    <div v-if="!itens.length && !carregando && !erro" class="empty">{{ busca.trim() ? 'Ninguém encontrado.' : 'Nenhum cliente por aqui ainda.' }}</div>
    <div v-if="carregando && !itens.length" class="empty">Carregando…</div>
  </div>
  <button v-if="temMais" class="btn b-out" :disabled="carregando" @click="carregar(true)">{{ carregando ? 'Carregando…' : 'Carregar mais' }}</button>

  <Sheet :aberto="ficha !== null" @fechar="ficha = null">
    <template v-if="ficha">
      <div class="row" style="gap: 12px; margin-bottom: 12px"><span class="ini">{{ iniciais(ficha.nome) }}</span><div><h3>{{ ficha.nome }}</h3><div class="small">cliente desde {{ dmyA(ficha.desde) }}</div></div></div>
      <div class="dl card pad">
        <div><div class="lbl">WhatsApp</div><a class="val" :href="linkZap(ficha.fone)" target="_blank" rel="noopener">{{ mascaraFone(ficha.fone) }}</a></div>
        <template v-if="veDocumentos">
          <div><div class="lbl">CPF</div><div class="val num">{{ ficha.cpf ? mascaraCpf(ficha.cpf) : '—' }}</div></div>
          <div><div class="lbl">RG</div><div class="val">{{ ficha.rg || '—' }}</div></div>
          <div><div class="lbl">Como chegou</div><div class="val">{{ ficha.origem || '—' }}</div></div>
          <div style="grid-column: 1 / -1"><div class="lbl">Endereço</div><div class="val">{{ ficha.endereco || '—' }}</div></div>
          <div v-if="nomeResponsavel(ficha.responsavelId)"><div class="lbl">Responsável</div><div class="val">{{ nomeResponsavel(ficha.responsavelId) }}</div></div>
        </template>
      </div>
      <button v-if="podeEditar" class="btn b-out b-block" style="margin-top: 12px" @click="editar(ficha)">Editar cadastro</button>
      <template v-if="modoDemo && opsDoCliente.length">
        <div class="sec-t" style="margin: 16px 0 0"><h2>Operações</h2></div>
        <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px"><OperacaoCard v-for="o in opsDoCliente" :key="o.id" :o="o" :k="contas(o)" /></div>
      </template>
    </template>
  </Sheet>

  <ClienteForm :aberto="formAberto" :cliente="editando" @fechar="formAberto = false" @salvo="aoSalvar" />
</template>
