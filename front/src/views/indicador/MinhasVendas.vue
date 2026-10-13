<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { EmprestimoApi } from '@/api/emprestimos'
import { todasAsPaginas } from '@/api/paginar'
import { emprestimosApi, vendasApi } from '@/api/recursos'
import type { VendaApi } from '@/api/vendas'
import Abas from '@/components/Abas.vue'
import Icon from '@/components/Icon.vue'
import IndicarFluxo from '@/components/IndicarFluxo.vue'
import { useApp } from '@/composables/useApp'
import { fmt, fmt0, gbTxt } from '@/domain/format'

/** As vendas e empréstimos que o indicador trouxe: só leitura (quem cadastra é a loja). Mostra a parte dele, nunca custo nem lucro. */
const { sessao } = useApp()
const vendas = ref<VendaApi[]>([])
const emps = ref<EmprestimoApi[]>([])
const aba = ref('iphone')
const carregando = ref(true)
const erro = ref('')
const fluxo = ref<InstanceType<typeof IndicarFluxo> | null>(null)

onMounted(async () => {
  try {
    const s = sessao.value
    ;[vendas.value, emps.value] = await Promise.all([todasAsPaginas((p) => vendasApi.listar(s, { pagina: p, limite: 100 })), todasAsPaginas((p) => emprestimosApi.listar(s, { pagina: p, limite: 100 }))])
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar as vendas.'
  } finally {
    carregando.value = false
  }
})

const ativo = (o: { status: string }) => o.status === 'ATIVA'
const lista = computed(() => (aba.value === 'iphone' ? vendas.value : emps.value))
const abas = computed(() => [{ id: 'iphone', label: 'iPhones', icon: 'smartphone', n: vendas.value.length }, { id: 'emp', label: 'Empréstimos', icon: 'landmark', n: emps.value.length }])
const resumo = computed(() => ({
  aReceber: Math.round(lista.value.filter((o) => ativo(o)).reduce((x, o) => x + o.falta, 0) * 100) / 100,
  recebido: Math.round(lista.value.reduce((x, o) => x + o.recebido, 0) * 100) / 100,
  ativas: lista.value.filter(ativo).length,
}))
const CHIP: Record<string, string> = { ATIVA: 'c-ok', QUITADA: 'c-ok', RETOMADA: 'c-bad', CANCELADA: 'c-neu' }
const rotulo = (o: { status: string; atrasadas: number }) => (o.status === 'QUITADA' ? 'quitada' : o.status === 'RETOMADA' ? 'retomada' : o.status === 'CANCELADA' ? 'cancelada' : o.atrasadas > 0 ? `${o.atrasadas} atrasada${o.atrasadas > 1 ? 's' : ''}` : 'em dia')
const chip = (o: { status: string; atrasadas: number }) => (o.status === 'ATIVA' && o.atrasadas > 0 ? 'c-bad' : CHIP[o.status])
const pagas = (o: { parcelas: { falta: number }[] }) => o.parcelas.filter((p) => p.falta <= 0.009).length
const barra = (o: { recebido: number; total: number }) => (o.total > 0 ? Math.min(100, Math.round((o.recebido / o.total) * 100)) : 100)
const nomeEmp = (e: EmprestimoApi) => (e.modalidade === 'JUROS' ? 'Empréstimo só juros' : e.modalidade === 'DIARIA' ? 'Empréstimo diário' : 'Empréstimo parcelado')
</script>

<template>
  <div class="row" style="justify-content: space-between; gap: 12px">
    <p class="small" style="margin: 0; flex: 1">O que você trouxe para a loja. Quem cadastra a venda é a loja.</p>
    <button class="btn b-pri b-sm" @click="fluxo?.abrir()"><Icon name="plus" small />Indicar cliente</button>
  </div>
  <Abas v-model="aba" :itens="abas" />
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
  <div class="kpi3" data-testid="resumo-vendas">
    <div><div class="lbl">A receber</div><div class="val num">{{ fmt0(resumo.aReceber) }}</div></div>
    <div><div class="lbl">Já recebido</div><div class="val num">{{ fmt0(resumo.recebido) }}</div></div>
    <div><div class="lbl">Ativas</div><div class="val num">{{ resumo.ativas }}</div></div>
  </div>
  <div class="fones" style="margin-top: 14px" data-testid="minhas-vendas">
    <div v-for="o in lista" :key="o.id" class="card pad" style="display: flex; flex-direction: column; gap: 10px" :data-venda="o.id">
      <div class="row" style="justify-content: space-between; gap: 8px">
        <div style="min-width: 0"><div class="val">{{ o.cliente.nome }}</div><div class="small">{{ 'aparelho' in o ? `${o.aparelho.modelo} ${gbTxt(o.aparelho.gb)} · ${o.aparelho.cor}` : nomeEmp(o) }}</div></div>
        <span class="chip" :class="chip(o)" data-status>{{ rotulo(o) }}</span>
      </div>
      <div class="bar"><i :style="{ width: barra(o) + '%' }"></i></div>
      <div class="row small" style="justify-content: space-between"><span class="num">{{ fmt0(o.recebido) }} de {{ fmt0(o.total) }}</span><span>{{ pagas(o) }}/{{ o.nParcelas }} parcelas</span></div>
      <div class="small" style="color: var(--primary); font-weight: 600" data-sua-parte>sua parte {{ fmt(o.suaParte ?? 0) }}<template v-if="(o.jaLiberado ?? 0) > 0"> · já liberou {{ fmt(o.jaLiberado ?? 0) }}</template></div>
    </div>
    <div v-if="!lista.length && !carregando && !erro" class="card empty">{{ aba === 'iphone' ? 'Nenhuma venda sua ainda.' : 'Nenhum empréstimo seu ainda.' }}</div>
  </div>
  <IndicarFluxo ref="fluxo" />
</template>
