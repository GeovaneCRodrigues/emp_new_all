<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { recebimentosApi } from '@/api/recursos'
import type { PagamentoApi } from '@/api/recebimentos'
import type { VendaApi } from '@/api/vendas'
import { useApp } from '@/composables/useApp'
import { dmy, dmyA, fmt, fmt0 } from '@/domain/format'
import Sheet from './Sheet.vue'

const props = defineProps<{ venda: VendaApi | null }>()
const emit = defineEmits<{ fechar: []; receber: [parcela: number]; recibo: [id: number]; desfazer: [id: number] }>()
const { hoje, sessao } = useApp()

const podeReceber = computed(() => sessao.value.perfil === 'ADMIN' || sessao.value.perfil === 'COBRADOR')
const pagamentos = ref<PagamentoApi[]>([])
async function carregarPagamentos() {
  if (!props.venda || !podeReceber.value) { pagamentos.value = []; return }
  pagamentos.value = await recebimentosApi.pagamentos(sessao.value, props.venda.id).catch(() => [])
}
watch(() => props.venda, carregarPagamentos, { immediate: true })

const pct = computed(() => (props.venda && props.venda.total > 0 ? Math.round((props.venda.recebido / props.venda.total) * 100) : 100))
const capPct = computed(() => (props.venda?.custoNoDia ? Math.round(((props.venda.capitalDeVolta ?? 0) / props.venda.custoNoDia) * 100) : 0))
const situacao = (p: VendaApi['parcelas'][number]) => (p.falta <= 0.009 ? 'paga' : p.vencimento < hoje.value ? 'atrasada' : 'aberta')
const NOME_FORMA = { PIX: 'Pix', DINHEIRO: 'Dinheiro', CARTAO: 'Cartão' } as const
const CONTRATO = { AGUARDANDO: 'aguardando envio', ENVIADO: 'enviado, esperando assinatura', ASSINADO: 'assinado' } as const
</script>

<template>
  <Sheet :aberto="venda !== null" @fechar="$emit('fechar')">
    <template v-if="venda">
      <h3>{{ venda.cliente.nome }}</h3>
      <div class="small">{{ venda.aparelho.modelo }} · {{ venda.aparelho.gb }} GB · {{ venda.aparelho.cor }} · vendido em {{ dmyA(venda.dataVenda) }}</div>

      <div class="card pad" style="margin-top: 12px">
        <div class="between small"><span><b class="num" style="color: var(--strong)">{{ fmt(venda.recebido) }}</b> recebido de {{ fmt(venda.total) }}</span><span class="num">{{ pct }}%</span></div>
        <div class="bar" style="margin-top: 6px"><i :style="{ width: pct + '%', background: venda.atrasadas ? 'var(--bad)' : 'var(--primary)' }"></i></div>
        <div class="small" style="margin-top: 6px">Falta <b class="num" style="color: var(--strong)">{{ fmt(venda.falta) }}</b><template v-if="venda.atrasadas"> · <b style="color: var(--bad)">{{ venda.atrasadas }} atrasada{{ venda.atrasadas > 1 ? 's' : '' }}</b></template></div>
      </div>

      <div class="dl card pad" style="margin-top: 10px">
        <div><div class="lbl">Preço combinado</div><div class="val num">{{ fmt(venda.precoAcordado) }}</div></div>
        <div><div class="lbl">Entrada</div><div class="val num">{{ fmt(venda.entrada) }}</div></div>
        <div v-if="venda.troca"><div class="lbl">Troca</div><div class="val num">{{ fmt(venda.troca) }}</div></div>
        <div><div class="lbl">Parcelas</div><div class="val num">{{ venda.nParcelas ? `${venda.nParcelas}x ${fmt(venda.valorParcela)}` : 'à vista' }}</div><div v-if="venda.nParcelas" class="small">{{ venda.jurosPct }}% por parcela</div></div>
        <div><div class="lbl">Indicador</div><div class="val">{{ venda.indicador?.nome ?? '—' }}</div></div>
        <div><div class="lbl">Contrato</div><div class="val">{{ CONTRATO[venda.contrato] }}</div></div>
      </div>

      <div v-if="venda.custoNoDia !== undefined" class="dl card pad" style="margin-top: 10px">
        <div><div class="lbl">Custo do aparelho</div><div class="val num">{{ fmt(venda.custoNoDia) }}</div></div>
        <div><div class="lbl">Lucro total</div><div class="val num" style="color: var(--ok)">{{ fmt(venda.lucroTotal ?? 0) }}</div></div>
        <div v-if="venda.indicador"><div class="lbl">Parte do indicador ({{ Math.round((venda.percentualIndicador ?? 0) * 100) }}%)</div><div class="val num">{{ fmt(venda.parteIndicador ?? 0) }}</div></div>
        <div><div class="lbl">Seu lucro</div><div class="val num" style="color: var(--ok)">{{ fmt(venda.seuLucro ?? 0) }}</div></div>
        <div style="grid-column: 1 / -1"><div class="between small"><span>Seu capital de volta</span><span class="num">{{ capPct }}%</span></div><div class="bar" style="margin-top: 5px"><i :style="{ width: capPct + '%' }"></i></div></div>
      </div>

      <template v-if="venda.parcelas.length">
        <div class="lbl" style="margin: 14px 0 6px">Parcelas</div>
        <div class="timeline" style="margin-bottom: 8px"><i v-for="p in venda.parcelas" :key="p.numero" :class="{ p: situacao(p) === 'paga', a: situacao(p) === 'atrasada' }" :title="`Parcela ${p.numero}`">{{ p.numero }}</i></div>
        <div class="card list">
          <div v-for="p in venda.parcelas" :key="p.numero" class="li" :data-parcela="p.numero">
            <span class="mid"><span class="t">{{ p.numero }}ª · {{ dmy(p.vencimento) }}<template v-if="p.vencimentoOriginal"> (era {{ dmy(p.vencimentoOriginal) }})</template></span><span class="s">{{ fmt(p.valor) }}<template v-if="p.pago > 0 && p.falta > 0"> · já pagou {{ fmt0(p.pago) }}</template></span></span>
            <span class="chip" :class="{ 'c-ok': situacao(p) === 'paga', 'c-bad': situacao(p) === 'atrasada', 'c-neu': situacao(p) === 'aberta' }">{{ situacao(p) }}</span>
            <button v-if="podeReceber && situacao(p) !== 'paga'" class="btn b-ok b-sm" :data-receber="p.numero" @click="emit('receber', p.numero)">Recebi</button>
          </div>
        </div>
      </template>

      <template v-if="podeReceber && pagamentos.length">
        <div class="lbl" style="margin: 14px 0 6px">Pagamentos</div>
        <div class="card list" data-testid="pagamentos">
          <div v-for="g in pagamentos" :key="g.transacaoId" class="li" :class="{ 'esmaecido': g.desfeita }" :data-pagamento="g.transacaoId">
            <span class="mid"><span class="t">{{ g.referencia }} · {{ fmt(g.valor) }}<template v-if="g.desfeita"> (desfeito)</template></span><span class="s">{{ dmy(g.data) }} · {{ NOME_FORMA[g.forma] }} · {{ g.recebidoPor }} · recibo {{ g.numero }}</span></span>
            <button class="btn b-out b-sm" @click="emit('recibo', g.transacaoId)">Recibo</button>
            <button v-if="g.podeDesfazer" class="btn b-ghost b-sm" @click="emit('desfazer', g.transacaoId)">Desfazer</button>
          </div>
        </div>
      </template>
    </template>
  </Sheet>
</template>
