<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EmprestimoApi } from '@/api/emprestimos'
import type { PagamentoApi } from '@/api/recebimentos'
import { recebimentosApi } from '@/api/recursos'
import { useApp } from '@/composables/useApp'
import { nomeEmprestimo, taxaTexto } from '@/domain/emprestimo'
import { dmy, dmyA, fmt } from '@/domain/format'
import AcordoForm from './AcordoForm.vue'
import Icon from './Icon.vue'
import PedirDescontoForm from './PedirDescontoForm.vue'
import Sheet from './Sheet.vue'

const props = defineProps<{ emprestimo: EmprestimoApi | null }>()
const emit = defineEmits<{ fechar: []; receber: [parcela: number, quitar?: boolean]; recibo: [id: number]; desfazer: [id: number]; mudou: []; unificar: [emprestimo: EmprestimoApi] }>()
const { hoje, sessao } = useApp()

const pagamentos = ref<PagamentoApi[]>([])
async function carregarPagamentos() {
  if (!props.emprestimo) { pagamentos.value = []; return }
  pagamentos.value = await recebimentosApi.pagamentos(sessao.value, 'EMPRESTIMO', props.emprestimo.id).catch(() => [])
}
watch(() => props.emprestimo, carregarPagamentos, { immediate: true })
// acordo: só o administrador, empréstimo em andamento com saldo
const ehCobrador = computed(() => sessao.value.perfil === 'COBRADOR')
// desconto: o cobrador pede por parcela
const descontando = ref<{ numero: number; falta: number; vencimento: string } | null>(null)
function aoPedirDesconto() { descontando.value = null; emit('mudou') }
const podeAcordo = computed(() => (sessao.value.perfil === 'ADMIN' || sessao.value.perfil === 'COBRADOR') && props.emprestimo?.status === 'ATIVA' && (props.emprestimo?.falta ?? 0) > 0.009)
const podeUnificar = computed(() => sessao.value.perfil === 'ADMIN' && props.emprestimo?.status === 'ATIVA' && (props.emprestimo?.falta ?? 0) > 0.009)
// quitar: só o administrador; abre o recebimento da primeira parcela em aberto já com o valor que zera tudo
const primeiraAberta = computed(() => props.emprestimo?.parcelas.find((p) => situacao(p) !== 'paga' && situacao(p) !== 'acordo') ?? null)
const podeQuitar = computed(() => sessao.value.perfil === 'ADMIN' && props.emprestimo?.status === 'ATIVA' && (props.emprestimo?.falta ?? 0) > 0.009 && primeiraAberta.value !== null)
const acordando = ref(false)
function aoFazerAcordo() { acordando.value = false; emit('mudou') }
const NOME_FORMA = { PIX: 'Pix', DINHEIRO: 'Dinheiro', CARTAO: 'Cartão' } as const

const pct = computed(() => (props.emprestimo && props.emprestimo.total > 0 ? Math.round((props.emprestimo.recebido / props.emprestimo.total) * 100) : 100))
const capPct = computed(() => (props.emprestimo?.capital ? Math.round(((props.emprestimo.capitalDeVolta ?? 0) / props.emprestimo.capital) * 100) : 0))
const situacao = (p: EmprestimoApi['parcelas'][number]) => (p.acordo === 'ENCERRADA' ? 'acordo' : p.falta <= 0.009 ? 'paga' : p.vencimento < hoje.value ? 'atrasada' : 'aberta')
</script>

<template>
  <Sheet :aberto="emprestimo !== null" @fechar="emit('fechar')">
    <template v-if="emprestimo">
      <h3>{{ emprestimo.cliente.nome }}</h3>
      <div class="small">{{ nomeEmprestimo(emprestimo.modalidade, emprestimo.periodicidade) }}<template v-if="emprestimo.periodicidade === 'DIARIA'"> ({{ emprestimo.pulaDomingo ? 'sem domingo' : 'com domingo' }})</template> · emprestado em {{ dmyA(emprestimo.dataEmprestimo) }}</div>

      <div class="card pad" style="margin-top: 12px">
        <div class="between small"><span><b class="num" style="color: var(--strong)">{{ fmt(emprestimo.recebido) }}</b> recebido de {{ fmt(emprestimo.total) }}</span><span class="num">{{ pct }}%</span></div>
        <div class="bar" style="margin-top: 6px"><i :style="{ width: pct + '%', background: emprestimo.atrasadas ? 'var(--bad)' : 'var(--primary)' }"></i></div>
        <div class="small" style="margin-top: 6px">Falta <b class="num" style="color: var(--strong)">{{ fmt(emprestimo.falta) }}</b><template v-if="emprestimo.atrasadas"> · <b style="color: var(--bad)">{{ emprestimo.atrasadas }} atrasada{{ emprestimo.atrasadas > 1 ? 's' : '' }}</b></template></div>
      </div>

      <div v-if="emprestimo.capital !== undefined" class="dl card pad" style="margin-top: 10px" data-testid="dados-admin">
        <div><div class="lbl">Capital emprestado</div><div class="val num">{{ fmt(emprestimo.capital) }}</div></div>
        <div><div class="lbl">Taxa</div><div class="val num">{{ taxaTexto(emprestimo.modalidade, emprestimo.periodicidade, emprestimo.taxa ?? 0) }}</div></div>
        <div><div class="lbl">Parcelas</div><div class="val num">{{ emprestimo.nParcelas }}x {{ fmt(emprestimo.valorParcela) }}</div><div v-if="emprestimo.modalidade === 'JUROS'" class="small">só o juro; o capital vem na última</div><div v-if="emprestimo.modalidade === 'DIARIA'" class="small">uma por dia útil, sem domingo</div></div>
        <div><div class="lbl">Indicador</div><div class="val">{{ emprestimo.indicador?.nome ?? '—' }}</div></div>
        <div><div class="lbl">Lucro total</div><div class="val num" style="color: var(--ok)">{{ fmt(emprestimo.lucroTotal ?? 0) }}</div></div>
        <div v-if="emprestimo.indicador"><div class="lbl">Parte do indicador ({{ Math.round((emprestimo.percentualIndicador ?? 0) * 100) }}%)</div><div class="val num">{{ fmt(emprestimo.parteIndicador ?? 0) }}</div></div>
        <div><div class="lbl">Seu lucro</div><div class="val num" style="color: var(--ok)">{{ fmt(emprestimo.seuLucro ?? 0) }}</div></div>
        <div style="grid-column: 1 / -1"><div class="between small"><span>Seu capital de volta</span><span class="num">{{ capPct }}%</span></div><div class="bar" style="margin-top: 5px"><i :style="{ width: capPct + '%', background: 'var(--gold)' }"></i></div></div>
      </div>
      <div v-else class="dl card pad" style="margin-top: 10px">
        <div><div class="lbl">Parcelas</div><div class="val num">{{ emprestimo.nParcelas }}x {{ fmt(emprestimo.valorParcela) }}</div></div>
      </div>
      <div v-if="emprestimo.observacoes" class="small" style="margin-top: 8px">{{ emprestimo.observacoes }}</div>
      <div v-if="podeQuitar || podeAcordo || podeUnificar" class="acoes-ficha" data-acoes-ficha>
        <button v-if="podeQuitar" class="btn b-ok acao-quad" data-quitar title="Quitou · receber tudo e encerrar" aria-label="Quitou · receber tudo e encerrar" @click="primeiraAberta && emit('receber', primeiraAberta.numero, true)"><Icon name="check" /><span>Quitou</span></button>
        <button v-if="podeAcordo" class="btn b-out acao-quad" data-acordo :title="ehCobrador ? 'Pedir acordo' : 'Fazer acordo'" :aria-label="ehCobrador ? 'Pedir acordo' : 'Fazer acordo'" @click="acordando = true"><Icon name="handshake" /><span>{{ ehCobrador ? 'Pedir acordo' : 'Acordo' }}</span></button>
        <button v-if="podeUnificar" class="btn b-out acao-quad" data-unificar title="Unificar com outro empréstimo" aria-label="Unificar com outro empréstimo" @click="emit('unificar', emprestimo)"><Icon name="layers" /><span>Unificar</span></button>
      </div>
      <div v-if="emprestimo.unificadoDe?.length" class="aviso" style="margin-top: 8px" data-testid="unificado-de">Unificado a partir dos empréstimos {{ emprestimo.unificadoDe.map((i) => '#' + i).join(', ') }}.</div>
      <div v-if="emprestimo.unificadoEm" class="aviso" style="margin-top: 8px" data-testid="unificado-em">Unificado no empréstimo #{{ emprestimo.unificadoEm }}.</div>

      <div class="lbl" style="margin: 14px 0 6px">Parcelas</div>
      <div class="row" style="gap: 6px; margin-bottom: 6px" data-resumo-parcelas><span class="chip c-ok" data-parcelas-pagas>{{ emprestimo.parcelas.filter((p) => situacao(p) === 'paga').length }} pagas</span><span class="chip" :class="emprestimo.parcelas.some((p) => situacao(p) === 'atrasada') ? 'c-bad' : 'c-neu'" data-parcelas-atrasadas>{{ emprestimo.parcelas.filter((p) => situacao(p) === 'atrasada').length }} atrasadas</span></div>
      <div class="timeline" style="margin-bottom: 8px"><i v-for="p in emprestimo.parcelas" :key="p.numero" :class="{ p: situacao(p) === 'paga' || situacao(p) === 'acordo', a: situacao(p) === 'atrasada' }" :title="`Parcela ${p.numero}: ${dmy(p.vencimento)}`"></i></div>
      <div class="list">
        <div v-for="p in emprestimo.parcelas" :key="p.numero" class="li" style="cursor: default" :data-parcela="p.numero">
          <div class="mid"><div class="t">{{ p.numero }}ª · {{ dmy(p.vencimento) }}<template v-if="p.vencimentoOriginal"> (era {{ dmy(p.vencimentoOriginal) }})</template></div><div class="s">{{ fmt(p.valor) }} · {{ p.pago > 0 ? `pagou ${fmt(p.pago)}` : 'nada pago' }}<template v-if="p.desconto"> · desconto {{ fmt(p.desconto) }}</template></div></div>
          <span class="chip" :class="situacao(p) === 'paga' ? 'c-ok' : situacao(p) === 'atrasada' ? 'c-bad' : 'c-neu'">{{ situacao(p) === 'paga' ? 'paga' : situacao(p) === 'acordo' ? 'acordo' : fmt(p.falta) }}</span>
 <button v-if="ehCobrador && situacao(p) !== 'paga' && situacao(p) !== 'acordo' && emprestimo.status === 'ATIVA'" class="btn b-ghost b-sm" :data-desconto="p.numero" @click="descontando = { numero: p.numero, falta: p.falta, vencimento: p.vencimento }">Desconto</button>
          <button v-if="situacao(p) !== 'paga' && situacao(p) !== 'acordo'" class="btn b-ok b-sm" :data-receber="p.numero" @click="emit('receber', p.numero)">Recebi</button>
        </div>
      </div>

      <template v-if="pagamentos.length">
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

  <PedirDescontoForm :aberto="descontando !== null" alvo="EMPRESTIMO" :operacao="emprestimo ? { id: emprestimo.id, cliente: emprestimo.cliente.nome, descricao: nomeEmprestimo(emprestimo.modalidade, emprestimo.periodicidade) } : null" :parcela="descontando" @fechar="descontando = null" @feito="aoPedirDesconto" />
  <AcordoForm :aberto="acordando" alvo="EMPRESTIMO" :operacao="emprestimo ? { id: emprestimo.id, cliente: emprestimo.cliente.nome, descricao: nomeEmprestimo(emprestimo.modalidade, emprestimo.periodicidade), saldo: emprestimo.falta } : null" @fechar="acordando = false" @feito="aoFazerAcordo" />
</template>

<style scoped>
/* quitar / acordo / unificar: uma linha só, três quadradinhos com ícone */
.acoes-ficha { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
.acao-quad { flex-direction: column; gap: 4px; height: auto; min-height: 62px; padding: 8px 6px; font-size: 13px; line-height: 1.2; text-align: center; }
</style>
