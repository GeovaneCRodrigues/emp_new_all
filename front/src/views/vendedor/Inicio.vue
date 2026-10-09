<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ErroApi } from '@/api/clientes'
import type { ResumoEstoqueApi } from '@/api/estoque'
import { estoqueApi, vendasApi } from '@/api/recursos'
import type { VendaApi } from '@/api/vendas'
import Icon from '@/components/Icon.vue'
import { useApp } from '@/composables/useApp'
import { fmt0, iniciais } from '@/domain/format'

const router = useRouter()
const { sessao, hoje } = useApp()

const vendas = ref<VendaApi[]>([])
const estoque = ref<ResumoEstoqueApi | null>(null)
const carregando = ref(true)
const erro = ref('')

async function carregar() {
  erro.value = ''
  try {
    const [v, e] = await Promise.all([vendasApi.listar(sessao.value, { limite: 100 }), estoqueApi.resumo(sessao.value)])
    vendas.value = v.itens; estoque.value = e
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar o início.'
  } finally {
    carregando.value = false
  }
}
onMounted(carregar)

const doMes = computed(() => vendas.value.filter((v) => v.status !== 'CANCELADA' && v.dataVenda.slice(0, 7) === hoje.value.slice(0, 7)))
const totalMes = computed(() => doMes.value.reduce((s, v) => s + v.total, 0))
const semContrato = computed(() => vendas.value.filter((v) => v.status === 'ATIVA' && v.contrato !== 'ASSINADO'))
const comAtraso = computed(() => {
  const por = new Map<number, { id: number; nome: string; parcelas: number }>()
  for (const v of vendas.value) {
    if (v.status !== 'ATIVA' || !v.atrasadas) continue
    const c = por.get(v.cliente.id) ?? { id: v.cliente.id, nome: v.cliente.nome, parcelas: 0 }
    c.parcelas += v.atrasadas
    por.set(v.cliente.id, c)
  }
  return [...por.values()].sort((a, b) => b.parcelas - a.parcelas)
})
</script>

<template>
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar">Tentar de novo</button></div>
  <div v-if="carregando" class="card empty">Carregando…</div>
  <div v-else class="inicio">
    <div class="col">
      <section class="hero">
        <div class="lbl">Vendas no mês</div>
        <div class="big disp num" data-testid="vendas-mes">{{ doMes.length }}</div>
        <div class="lbl">{{ doMes.length ? fmt0(totalMes) + ' vendidos' : 'nenhuma ainda' }}</div>
        <div class="acts"><button class="btn gold" @click="router.push('/vender')"><Icon name="plus" small />Nova venda</button><button class="btn" @click="router.push('/simulador')"><Icon name="calculator" small />Simulador</button></div>
      </section>

      <div class="kpis">
        <button @click="router.push('/estoque')"><div class="lbl">Disponíveis</div><div class="val num" data-testid="disponiveis">{{ estoque?.disponiveis ?? '—' }}</div><div class="small">{{ estoque ? fmt0(estoque.valorEmVitrine) + ' em vitrine' : '' }}</div></button>
        <button @click="router.push('/vendas')"><div class="lbl">Minhas vendas</div><div class="val num">{{ vendas.length }}</div><div class="small">no total</div></button>
        <div><div class="lbl">Clientes atrasados</div><div class="val num" :style="{ color: comAtraso.length ? 'var(--bad)' : 'var(--ok)' }">{{ comAtraso.length }}</div></div>
      </div>
    </div>

    <div class="col">
      <div class="sec-t"><h2>Contrato esperando assinatura</h2></div>
      <div class="card list" data-testid="contratos">
        <button v-for="v in semContrato" :key="v.id" class="li" @click="router.push('/vendas')">
          <span class="ini">{{ iniciais(v.cliente.nome) }}</span>
          <div class="mid"><div class="t">{{ v.cliente.nome }}</div><div class="s">{{ v.aparelho.modelo }} · {{ v.contrato === 'ENVIADO' ? 'enviado, falta assinar' : 'ainda não enviado' }}</div></div>
          <span class="chip" :class="v.contrato === 'ENVIADO' ? 'c-warn' : 'c-neu'">{{ v.contrato === 'ENVIADO' ? 'enviado' : 'aguardando' }}</span>
        </button>
        <div v-if="!semContrato.length" class="empty">Todos os contratos assinados.</div>
      </div>

      <div class="sec-t"><h2>Clientes com atraso</h2></div>
      <div class="card list" data-testid="atrasados">
        <button v-for="c in comAtraso" :key="c.id" class="li" @click="router.push('/clientes')">
          <span class="ini">{{ iniciais(c.nome) }}</span>
          <div class="mid"><div class="t">{{ c.nome }}</div><div class="s">{{ c.parcelas }} parcela{{ c.parcelas > 1 ? 's' : '' }} atrasada{{ c.parcelas > 1 ? 's' : '' }}</div></div>
          <span class="chip c-bad">atrasado</span>
        </button>
        <div v-if="!comAtraso.length" class="empty">Ninguém atrasado 🎉</div>
      </div>
    </div>
  </div>
</template>
