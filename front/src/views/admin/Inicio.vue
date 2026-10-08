<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import CobLinha from '@/components/CobLinha.vue'
import Icon from '@/components/Icon.vue'
import MiniFone from '@/components/MiniFone.vue'
import { useApp } from '@/composables/useApp'
import { faltaP, investido } from '@/domain/calc'
import { diasEntre } from '@/domain/datas'
import { fmt, fmt0 } from '@/domain/format'

const router = useRouter()
const { d, hoje, cobrancas, contas, operacoes } = useApp()

const abertas = computed(() => cobrancas.value.filter((x) => !x.p.pago))
const venceHoje = computed(() => abertas.value.filter((x) => x.p.venc === hoje.value))
const atrasadas = computed(() => abertas.value.filter((x) => x.p.venc < hoje.value))
const proximas = computed(() => abertas.value.filter((x) => x.p.venc > hoje.value).sort((a, b) => a.p.venc.localeCompare(b.p.venc)))
const semana = computed(() => proximas.value.filter((x) => diasEntre(hoje.value, x.p.venc) <= 7))

const vendasMes = computed(() => (d.value?.vendas ?? []).filter((v) => v.data.slice(0, 7) === hoje.value.slice(0, 7)))
const totalVendasMes = computed(() => vendasMes.value.reduce((s, v) => s + contas(v).total, 0))
const lucroNoBolso = computed(() => operacoes.value.reduce((s, o) => s + contas(o).lucroRealizado, 0))

const disponiveis = computed(() => (d.value?.bens ?? []).filter((b) => b.estado === 'DISPONIVEL'))
const parados = computed(() => disponiveis.value.map((b) => ({ b, dias: diasEntre(b.desde, hoje.value) })).sort((a, b) => b.dias - a.dias))
const capitalParado = computed(() => disponiveis.value.reduce((s, b) => s + investido(b), 0))

const paraReceber = computed(() => [...venceHoje.value, ...semana.value.filter((x) => x.p.venc !== hoje.value)].reduce((s, x) => s + faltaP(x.p), 0))
const qtdSemana = computed(() => venceHoje.value.length + semana.value.filter((x) => x.p.venc !== hoje.value).length)
const valorAtraso = computed(() => atrasadas.value.reduce((s, x) => s + faltaP(x.p), 0))
const dataExtenso = computed(() => new Date(hoje.value + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }))
</script>

<template>
  <div class="inicio">
    <div class="col">
      <section class="hero">
        <div class="between"><span class="lbl">Bom dia, Geovane · {{ dataExtenso }}</span></div>
        <div>
          <div class="lbl">Pra receber esta semana</div>
          <div class="big disp num">{{ fmt(paraReceber) }}</div>
          <div class="lbl" style="margin-top: 2px">
            {{ qtdSemana }} parcelas ·
            <b v-if="atrasadas.length" style="color: #ffd6cf">{{ fmt(valorAtraso) }} atrasado</b><template v-else>nada atrasado</template>
          </div>
        </div>
        <div class="acts">
          <button class="btn gold" @click="router.push('/cobrancas')"><Icon name="hand-coins" small />Ver cobranças</button>
          <button class="btn" @click="router.push('/vender')"><Icon name="plus" small />Nova venda</button>
        </div>
      </section>

      <div class="kpis">
        <button @click="router.push('/operacoes')">
          <div class="lbl">Vendas no mês</div><div class="val num">{{ vendasMes.length }}</div>
          <div class="small">{{ vendasMes.length ? fmt0(totalVendasMes) : 'nenhuma ainda' }}</div>
        </button>
        <div><div class="lbl">Lucro no bolso</div><div class="val num" style="color: var(--ok)">{{ fmt0(lucroNoBolso) }}</div><div class="small">após o capital</div></div>
        <button @click="router.push('/estoque')">
          <div class="lbl">No estoque</div><div class="val num">{{ fmt0(capitalParado) }}</div><div class="small">{{ disponiveis.length }} aparelhos</div>
        </button>
      </div>

      <div class="sec-t"><h2>Atrasadas</h2><button @click="router.push('/cobrancas')">Ver todas</button></div>
      <div class="card list">
        <CobLinha v-for="x in atrasadas.slice(0, 4)" :key="x.op.id + '-' + x.p.n" :x="x" @abrir="router.push('/operacoes')" />
        <div v-if="!atrasadas.length" class="empty">Ninguém atrasado 🎉</div>
      </div>
    </div>

    <div class="col">
      <div class="sec-t"><h2>Estoque parado há mais tempo</h2><button @click="router.push('/estoque')">Estoque</button></div>
      <div class="card list">
        <button v-for="{ b, dias } in parados.slice(0, 3)" :key="b.id" class="li" @click="router.push('/estoque')">
          <MiniFone :cor="b.cor" />
          <div class="mid"><div class="t">{{ b.modelo }} · {{ b.gb }} GB</div><div class="s">{{ b.cor }} · custo {{ fmt0(investido(b)) }}</div></div>
          <span class="chip" :class="dias > 30 ? 'c-warn' : 'c-neu'">{{ dias }} dias</span>
        </button>
      </div>

      <div class="sec-t"><h2>Próximos vencimentos</h2></div>
      <div class="card list">
        <CobLinha v-for="x in proximas.slice(0, 4)" :key="x.op.id + '-' + x.p.n" :x="x" @abrir="router.push('/operacoes')" />
      </div>
    </div>
  </div>
</template>
