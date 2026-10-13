<script setup lang="ts">
import { computed } from 'vue'
import type { EmprestimoApi } from '@/api/emprestimos'
import type { VendaApi } from '@/api/vendas'
import Icon from '@/components/Icon.vue'
import Sheet from '@/components/Sheet.vue'
import { useApp } from '@/composables/useApp'
import { diasDeAtraso, estadoParcela, resumoAndamento, type EstadoParcela } from '@/domain/andamento'
import { dmy, dmyA, fmt, fmt0, gbTxt } from '@/domain/format'

/**
 * O andamento de uma venda ou de um empréstimo para o INDICADOR acompanhar: quanto já entrou, o que falta e parcela a parcela.
 * Só leitura. A API já não manda custo, lucro da loja nem o motivo da retomada; aqui também nada disso é mostrado.
 */
const props = defineProps<{ operacao: VendaApi | EmprestimoApi | null }>()
defineEmits<{ fechar: [] }>()
const { hoje } = useApp()

const venda = computed(() => (props.operacao && 'aparelho' in props.operacao ? props.operacao : null))
const emprestimo = computed(() => (props.operacao && !('aparelho' in props.operacao) ? props.operacao : null))
const titulo = computed(() => {
  const o = props.operacao
  if (!o) return ''
  if ('aparelho' in o) return `${o.aparelho.modelo} ${gbTxt(o.aparelho.gb)} · ${o.aparelho.cor}`.replace(/\s+/g, ' ')
  return o.modalidade === 'JUROS' ? 'Empréstimo só juros' : o.modalidade === 'DIARIA' ? 'Empréstimo diário' : 'Empréstimo parcelado'
})
const inicio = computed(() => (venda.value ? venda.value.dataVenda : emprestimo.value?.dataEmprestimo ?? ''))
/** Venda retomada ou empréstimo cancelado não cobra mais nada: sem atraso, sem "falta receber". */
const ativa = computed(() => props.operacao?.status !== 'RETOMADA' && props.operacao?.status !== 'CANCELADA')
const r = computed(() => resumoAndamento(props.operacao?.parcelas ?? [], hoje.value, ativa.value))
const pct = computed(() => (props.operacao && props.operacao.total > 0 ? Math.min(100, Math.round((props.operacao.recebido / props.operacao.total) * 100)) : 100))
const entrada = computed(() => (venda.value ? Math.round((venda.value.entrada + venda.value.troca) * 100) / 100 : 0))

const ESTADO: Record<EstadoParcela, { texto: string; classe: string }> = {
  paga: { texto: 'paga', classe: 'c-ok' }, parcial: { texto: 'paga em parte', classe: 'c-warn' }, atrasada: { texto: 'atrasada', classe: 'c-bad' },
  hoje: { texto: 'vence hoje', classe: 'c-warn' }, aberta: { texto: 'a vencer', classe: 'c-neu' }, encerrada: { texto: 'encerrada', classe: 'c-neu' },
}
const linhas = computed(() => (props.operacao?.parcelas ?? []).map((p) => ({ p, estado: estadoParcela(p, hoje.value, ativa.value) })))
const motivoEncerrada = (acordo: string | null) => (acordo === 'ENCERRADA' ? 'encerrada por acordo' : props.operacao?.status === 'RETOMADA' ? 'venda retomada: sem cobrança' : 'empréstimo cancelado: sem cobrança')
const status = computed(() => {
  const o = props.operacao
  if (!o) return { texto: '', classe: '' }
  if (o.status === 'QUITADA') return { texto: 'quitada', classe: 'c-ok' }
  if (o.status === 'RETOMADA') return { texto: 'retomada', classe: 'c-bad' }
  if (o.status === 'CANCELADA') return { texto: 'cancelada', classe: 'c-neu' }
  return o.atrasadas > 0 ? { texto: `${o.atrasadas} atrasada${o.atrasadas > 1 ? 's' : ''}`, classe: 'c-bad' } : { texto: 'em dia', classe: 'c-ok' }
})
</script>

<template>
  <Sheet :aberto="!!operacao" @fechar="$emit('fechar')">
    <template v-if="operacao">
      <div class="row" style="justify-content: space-between; gap: 8px; align-items: flex-start">
        <div style="min-width: 0">
          <h3 data-andamento-titulo>{{ titulo }}</h3>
          <div class="small">{{ operacao.cliente.nome }} · desde {{ dmyA(inicio) }}</div>
        </div>
        <span class="chip" :class="status.classe" data-andamento-status>{{ status.texto }}</span>
      </div>

      <div class="bar" style="margin-top: 14px"><i :style="{ width: pct + '%' }"></i></div>
      <div class="row small" style="justify-content: space-between; margin-top: 6px">
        <span class="num" data-andamento-recebido>{{ fmt(operacao.recebido) }} de {{ fmt(operacao.total) }}</span>
        <span data-andamento-pagas>{{ r.pagas }}/{{ r.total }} parcelas pagas</span>
      </div>

      <div v-if="!ativa && operacao.status" class="aviso" style="margin-top: 12px" data-andamento-encerrada>{{ operacao.status === 'RETOMADA' ? 'Aparelho retomado pela loja: não há mais nada a receber desta venda.' : 'Empréstimo cancelado: não há nada a receber.' }}</div>
      <div v-if="ativa" class="grid2" style="margin-top: 14px">
        <div><div class="lbl">Falta receber</div><div class="val num" data-andamento-falta>{{ fmt(operacao.falta) }}</div></div>
        <div>
          <div class="lbl">Atrasado</div>
          <div class="val num" :style="{ color: r.atrasadas ? 'var(--bad)' : 'var(--strong)' }" data-andamento-atrasado>{{ r.atrasadas ? `${fmt(r.valorAtrasado)} (${r.atrasadas})` : '—' }}</div>
        </div>
        <div v-if="operacao.status === 'ATIVA'" style="grid-column: 1 / -1">
          <div class="lbl">Próxima parcela</div>
          <div v-if="r.proxima" class="val" data-andamento-proxima>
            parcela {{ r.proxima.numero }} · {{ fmt(r.proxima.falta) }} ·
            <template v-if="estadoParcela(r.proxima, hoje) === 'atrasada'"><span style="color: var(--bad)">venceu {{ dmy(r.proxima.vencimento) }} ({{ diasDeAtraso(r.proxima.vencimento, hoje) }} {{ diasDeAtraso(r.proxima.vencimento, hoje) === 1 ? 'dia' : 'dias' }})</span></template>
            <template v-else-if="r.proxima.vencimento === hoje">vence hoje</template>
            <template v-else>vence {{ dmy(r.proxima.vencimento) }}</template>
          </div>
          <div v-else class="val" data-andamento-proxima>nenhuma em aberto</div>
        </div>
      </div>
      <div v-if="operacao.status === 'RETOMADA' && venda?.retomada" style="margin-top: 10px"><div class="lbl">Aparelho retomado</div><div class="val">em {{ dmyA(venda.retomada.em) }}</div></div>

      <div class="small" style="color: var(--primary); font-weight: 600; margin-top: 12px" data-andamento-sua-parte>
        sua parte {{ fmt(operacao.suaParte ?? 0) }}<template v-if="(operacao.jaLiberado ?? 0) > 0"> · já liberou {{ fmt(operacao.jaLiberado ?? 0) }}</template>
      </div>

      <h4 style="margin: 16px 0 0; font-size: 13px; color: var(--strong)">Parcela a parcela</h4>
      <div class="passos andamento" data-andamento-parcelas>
        <div v-if="entrada > 0" class="ok" data-parcela="entrada">
          <span class="dot"><Icon name="check" small /></span>
          <div style="flex: 1; min-width: 0"><div class="t">Entrada</div><div class="small">{{ dmyA(inicio) }}</div></div>
          <b class="num">{{ fmt(entrada) }}</b>
        </div>
        <div v-for="l in linhas" :key="l.p.numero" :class="l.estado" :data-parcela="l.p.numero" :data-estado="l.estado">
          <span class="dot"><Icon v-if="l.estado === 'paga'" name="check" small /></span>
          <div style="flex: 1; min-width: 0">
            <div class="t">Parcela {{ l.p.numero }}<span v-if="l.p.acordo === 'NOVA'" class="small"> · do acordo</span></div>
            <div class="small">
              <template v-if="l.estado === 'paga'">paga{{ l.p.quitadaEm ? ` em ${dmy(l.p.quitadaEm)}` : '' }} · venceu {{ dmy(l.p.vencimento) }}</template>
              <template v-else-if="l.estado === 'atrasada'"><span style="color: var(--bad); font-weight: 600">venceu {{ dmy(l.p.vencimento) }} · {{ diasDeAtraso(l.p.vencimento, hoje) }} {{ diasDeAtraso(l.p.vencimento, hoje) === 1 ? 'dia' : 'dias' }}</span><template v-if="l.p.pago > 0"> · pagou {{ fmt(l.p.pago) }}</template></template>
              <template v-else-if="l.estado === 'parcial'">vence {{ dmy(l.p.vencimento) }} · pagou {{ fmt(l.p.pago) }}</template>
              <template v-else-if="l.estado === 'hoje'">vence hoje</template>
              <template v-else-if="l.estado === 'encerrada'">{{ motivoEncerrada(l.p.acordo) }}{{ l.p.pago > 0 ? ` · pagou ${fmt(l.p.pago)}` : '' }}</template>
              <template v-else>vence {{ dmy(l.p.vencimento) }}</template>
            </div>
          </div>
          <div style="text-align: right">
            <b class="num">{{ fmt0(l.p.valor) }}</b>
            <div><span class="chip" :class="ESTADO[l.estado].classe">{{ ESTADO[l.estado].texto }}</span></div>
          </div>
        </div>
      </div>
      <p class="small" style="margin: 12px 0 0">Só acompanhamento: quem recebe e dá baixa é a loja.</p>
    </template>
  </Sheet>
</template>
