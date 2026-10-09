<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ClienteApi } from '@/api/clientes'
import { ErroApi } from '@/api/clientes'
import { todasAsPaginas as todas } from '@/api/paginar'
import { clientesApi, emprestimosApi, vendasApi } from '@/api/recursos'
import FichasOperacao from '@/components/FichasOperacao.vue'
import Icon from '@/components/Icon.vue'
import Seg from '@/components/Seg.vue'
import Sheet from '@/components/Sheet.vue'
import { useApp } from '@/composables/useApp'
import { montarCarteira, noFiltro, semAcento, type ClienteCarteira, type FiltroCarteira, type OperacaoCarteira } from '@/domain/carteira'
import { nomeEmprestimo } from '@/domain/emprestimo'
import { fmt, fmt0, iniciais } from '@/domain/format'

/** Os clientes do cobrador, com o que cada um deve. A ficha do cliente leva às operações dele (Recebi e pedidos). */
const { sessao } = useApp()
const fichas = ref<InstanceType<typeof FichasOperacao> | null>(null)

const carteira = ref<ClienteCarteira<ClienteApi>[]>([])
const filtro = ref<FiltroCarteira>('TODOS')
const busca = ref('')
const carregando = ref(true)
const erro = ref('')
const aberto = ref<ClienteCarteira<ClienteApi> | null>(null)

async function carregar() {
  erro.value = ''
  try {
    const [clientes, vendas, emprestimos] = await Promise.all([
      todas((p) => clientesApi.listar(sessao.value, { pagina: p, limite: 100 })),
      todas((p) => vendasApi.listar(sessao.value, { pagina: p, limite: 100 })),
      todas((p) => emprestimosApi.listar(sessao.value, { pagina: p, limite: 100 })),
    ])
    const ops: OperacaoCarteira[] = [
      ...vendas.map((v) => ({ tipo: 'VENDA' as const, id: v.id, clienteId: v.cliente.id, descricao: `${v.aparelho.modelo} ${v.aparelho.gb} GB`, status: v.status, falta: v.falta, atrasadas: v.atrasadas })),
      ...emprestimos.map((e) => ({ tipo: 'EMPRESTIMO' as const, id: e.id, clienteId: e.cliente.id, descricao: nomeEmprestimo(e.modalidade, e.periodicidade), status: e.status, falta: e.falta, atrasadas: e.atrasadas })),
    ]
    carteira.value = montarCarteira(clientes, ops)
    // mantém a ficha do cliente aberta atualizada depois de um recebimento/pedido
    if (aberto.value) aberto.value = carteira.value.find((c) => c.cliente.id === aberto.value!.cliente.id) ?? null
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar a carteira.'
  } finally {
    carregando.value = false
  }
}
onMounted(carregar)
onBeforeUnmount(() => { aberto.value = null })

const contagem = computed(() => ({ TODOS: carteira.value.length, ATRASO: carteira.value.filter((c) => c.situacao === 'ATRASO').length, EM_DIA: carteira.value.filter((c) => c.situacao === 'EM_DIA').length }))
const filtros = computed(() => [
  { id: 'TODOS', label: `Todos · ${contagem.value.TODOS}` }, { id: 'ATRASO', label: `Atrasados · ${contagem.value.ATRASO}` }, { id: 'EM_DIA', label: `Em dia · ${contagem.value.EM_DIA}` },
])
const lista = computed(() => {
  const q = semAcento(busca.value).trim()
  return carteira.value.filter((c) => noFiltro(c, filtro.value) && (!q || semAcento(c.cliente.nome).includes(q)))
})

const zap = (c: ClienteApi) => `https://wa.me/${c.fone ? (c.fone.startsWith('55') ? c.fone : '55' + c.fone) : ''}`
const chip = (c: ClienteCarteira<ClienteApi>) => (c.situacao === 'ATRASO' ? { cls: 'c-bad', txt: `${c.atrasadas} atrasada${c.atrasadas > 1 ? 's' : ''}` } : c.situacao === 'EM_DIA' ? { cls: 'c-ok', txt: 'em dia' } : { cls: 'c-neu', txt: 'sem dívida' })
</script>

<template>
  <label class="busca"><Icon name="search" small /><input v-model="busca" placeholder="Buscar cliente" aria-label="Buscar cliente" /></label>
  <Seg v-model="filtro as string" :itens="filtros" />
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar">Tentar de novo</button></div>
  <div class="card list" data-testid="carteira">
    <button v-for="c in lista" :key="c.cliente.id" class="li" :data-cliente="c.cliente.id" @click="aberto = c">
      <span class="ini">{{ iniciais(c.cliente.nome) }}</span>
      <div class="mid"><div class="t">{{ c.cliente.nome }}</div><div class="s">{{ c.saldo > 0 ? `deve ${fmt0(c.saldo)}` : 'nada em aberto' }} · {{ c.operacoes.length }} {{ c.operacoes.length === 1 ? 'operação' : 'operações' }}</div></div>
      <span class="chip" :class="chip(c).cls">{{ chip(c).txt }}</span>
    </button>
    <div v-if="!lista.length && !carregando && !erro" class="empty">{{ busca.trim() ? 'Ninguém com esse nome.' : 'Ninguém aqui.' }}</div>
    <div v-if="carregando" class="empty">Carregando…</div>
  </div>

  <Sheet :aberto="aberto !== null" @fechar="aberto = null">
    <template v-if="aberto">
      <h3>{{ aberto.cliente.nome }}</h3>
      <div class="small">{{ aberto.saldo > 0 ? `Deve ${fmt(aberto.saldo)}` : 'Nada em aberto' }}<template v-if="aberto.atrasadas"> · <b style="color: var(--bad)">{{ aberto.atrasadas }} parcela{{ aberto.atrasadas > 1 ? 's' : '' }} atrasada{{ aberto.atrasadas > 1 ? 's' : '' }}</b></template></div>
      <a v-if="aberto.cliente.fone" class="btn b-out b-block" style="margin-top: 10px" :href="zap(aberto.cliente)" target="_blank" rel="noopener"><Icon name="message-circle" small />Chamar no WhatsApp</a>
      <div class="lbl" style="margin: 14px 0 6px">Operações</div>
      <div class="card list" data-testid="operacoes-do-cliente">
        <button v-for="o in aberto.operacoes" :key="o.tipo + o.id" class="li" :data-operacao="o.tipo + o.id" @click="fichas?.abrir(o.tipo, o.id)">
          <div class="mid"><div class="t">{{ o.descricao }}</div><div class="s">{{ o.status === 'ATIVA' ? `falta ${fmt(o.falta)}` : o.status === 'QUITADA' ? 'quitada' : o.status === 'RETOMADA' ? 'retomada' : 'cancelada' }}</div></div>
          <span v-if="o.status === 'ATIVA' && o.atrasadas" class="chip c-bad">{{ o.atrasadas }} atrasada{{ o.atrasadas > 1 ? 's' : '' }}</span>
          <span v-else-if="o.status === 'ATIVA'" class="chip c-ok">em dia</span>
        </button>
        <div v-if="!aberto.operacoes.length" class="empty">Nenhuma venda nem empréstimo.</div>
      </div>
      <div class="small" style="margin-top: 8px">Abra uma operação para dar baixa, pedir desconto, acordo ou retomada.</div>
    </template>
  </Sheet>
  <FichasOperacao ref="fichas" @mudou="carregar" />
</template>
