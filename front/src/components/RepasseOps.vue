<script setup lang="ts">
import type { OperacaoRepasseApi } from '@/api/repasses'
import { fmt, fmt0 } from '@/domain/format'

/**
 * As operações de um indicador no repasse. O administrador vê o capital voltando (R$ de R$); o indicador não recebe o
 * capital (é custo da loja), então vê o quanto o cliente já pagou e se o capital já voltou.
 */
defineProps<{ operacoes: OperacaoRepasseApi[] }>()
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`
const barra = (o: OperacaoRepasseApi) => {
  const base = o.investido !== undefined ? o.investido : o.total
  return base > 0 ? Math.min(100, Math.round((o.recebido / base) * 100)) : 100
}
const situacao = (o: OperacaoRepasseApi) => (o.aPagar > 0 ? `falta ${fmt(o.aPagar)}` : o.liberado > 0 ? 'tudo pago' : 'ainda não liberou')
</script>

<template>
  <div class="rep-ops">
    <div v-for="o in operacoes" :key="o.tipo + o.id" class="rep-op" :data-operacao="o.tipo + o.id">
      <div class="rep-op-l">
        <div class="t"><b>{{ o.clienteNome }}</b> <span class="small">· {{ o.descricao }} · {{ pct(o.pct) }}</span></div>
        <div class="bar" style="margin-top: 6px"><i :style="{ width: barra(o) + '%' }"></i></div>
        <div class="small" style="margin-top: 4px">
          <template v-if="o.investido !== undefined">{{ o.capitalVoltou ? 'capital já voltou' : `capital ${fmt0(o.recebido)} de ${fmt0(o.investido)}` }}</template>
          <template v-else>{{ o.capitalVoltou ? 'capital já voltou' : 'capital ainda voltando' }} · cliente pagou {{ fmt0(o.recebido) }} de {{ fmt0(o.total) }}</template>
        </div>
      </div>
      <div class="rep-op-r">
        <div><b class="num">{{ fmt(o.liberado) }}</b> <span class="small num">de {{ fmt(o.parte) }}</span></div>
        <div class="small">{{ situacao(o) }}</div>
      </div>
    </div>
  </div>
</template>
