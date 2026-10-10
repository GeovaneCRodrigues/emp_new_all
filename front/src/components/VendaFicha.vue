<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import { aprovacoesApi, recebimentosApi, vendasApi } from '@/api/recursos'
import type { PagamentoApi } from '@/api/recebimentos'
import type { VendaApi } from '@/api/vendas'
import { useApp } from '@/composables/useApp'
import { useToast } from '@/composables/useToast'
import { dmy, dmyA, fmt, fmt0, gbTxt } from '@/domain/format'
import AcordoForm from './AcordoForm.vue'
import PedirDescontoForm from './PedirDescontoForm.vue'
import Sheet from './Sheet.vue'

const props = defineProps<{ venda: VendaApi | null }>()
const emit = defineEmits<{ fechar: []; receber: [parcela: number]; recibo: [id: number]; desfazer: [id: number]; mudou: [] }>()
const { hoje, sessao } = useApp()

const { mostrar } = useToast()
// retomar o aparelho: só o administrador, venda em andamento com parcela atrasada
const podeRetomar = computed(() => (sessao.value.perfil === 'ADMIN' || sessao.value.perfil === 'COBRADOR') && props.venda?.status === 'ATIVA' && (props.venda?.atrasadas ?? 0) > 0)
// acordo: só o administrador, venda em andamento com saldo
const podeAcordo = computed(() => (sessao.value.perfil === 'ADMIN' || sessao.value.perfil === 'COBRADOR') && props.venda?.status === 'ATIVA' && (props.venda?.falta ?? 0) > 0.009)
const ehCobrador = computed(() => sessao.value.perfil === 'COBRADOR')
// desconto: o cobrador pede por parcela
const descontando = ref<{ numero: number; falta: number; vencimento: string } | null>(null)
function aoPedirDesconto() { descontando.value = null; emit('mudou') }
const acordando = ref(false)
function aoFazerAcordo() { acordando.value = false; emit('mudou') }
const retomando = ref(false)
const motivoRetomada = ref('')
const erroRetomada = ref('')
const enviandoRetomada = ref(false)
function abrirRetomada() { motivoRetomada.value = ''; erroRetomada.value = ''; retomando.value = true }
async function confirmarRetomada() {
  if (!props.venda || enviandoRetomada.value) return
  enviandoRetomada.value = true; erroRetomada.value = ''
  try {
    if (ehCobrador.value) {
      await aprovacoesApi.pedirRetomada(sessao.value, { operacaoId: props.venda.id, motivo: motivoRetomada.value.trim() })
      mostrar('Pedido de retomada enviado. O administrador vai responder.')
    } else {
      await vendasApi.retomar(sessao.value, props.venda.id, motivoRetomada.value.trim() ? { motivo: motivoRetomada.value.trim() } : {})
      mostrar('Aparelho retomado. Voltou pro estoque.')
    }
    retomando.value = false
    emit('mudou')
  } catch (e) {
    erroRetomada.value = e instanceof ErroApi ? e.message : 'Não consegui retomar. Tente de novo.'
  } finally {
    enviandoRetomada.value = false
  }
}

const podeReceber = computed(() => sessao.value.perfil === 'ADMIN' || sessao.value.perfil === 'COBRADOR')
const pagamentos = ref<PagamentoApi[]>([])
async function carregarPagamentos() {
  if (!props.venda || !podeReceber.value) { pagamentos.value = []; return }
  pagamentos.value = await recebimentosApi.pagamentos(sessao.value, 'VENDA', props.venda.id).catch(() => [])
}
watch(() => props.venda, carregarPagamentos, { immediate: true })

const pct = computed(() => (props.venda && props.venda.total > 0 ? Math.round((props.venda.recebido / props.venda.total) * 100) : 100))
const capPct = computed(() => (props.venda?.custoNoDia ? Math.round(((props.venda.capitalDeVolta ?? 0) / props.venda.custoNoDia) * 100) : 0))
const situacao = (p: VendaApi['parcelas'][number]) => (p.acordo === 'ENCERRADA' ? 'acordo' : p.falta <= 0.009 ? 'paga' : p.vencimento < hoje.value ? 'atrasada' : 'aberta')
const NOME_FORMA = { PIX: 'Pix', DINHEIRO: 'Dinheiro', CARTAO: 'Cartão' } as const
const CONTRATO = { AGUARDANDO: 'aguardando envio', ENVIADO: 'enviado, esperando assinatura', ASSINADO: 'assinado' } as const
</script>

<template>
  <Sheet :aberto="venda !== null" @fechar="$emit('fechar')">
    <template v-if="venda">
      <h3>{{ venda.cliente.nome }}</h3>
      <div class="small">{{ [venda.aparelho.modelo, gbTxt(venda.aparelho.gb)].filter(Boolean).join(' · ') }} · {{ venda.aparelho.cor }} · vendido em {{ dmyA(venda.dataVenda) }}</div>

      <div class="card pad" style="margin-top: 12px">
        <div class="between small"><span><b class="num" style="color: var(--strong)">{{ fmt(venda.recebido) }}</b> recebido de {{ fmt(venda.total) }}</span><span class="num">{{ pct }}%</span></div>
        <div class="bar" style="margin-top: 6px"><i :style="{ width: pct + '%', background: venda.atrasadas ? 'var(--bad)' : 'var(--primary)' }"></i></div>
        <div class="small" style="margin-top: 6px">Falta <b class="num" style="color: var(--strong)">{{ fmt(venda.falta) }}</b><template v-if="venda.atrasadas"> · <b style="color: var(--bad)">{{ venda.atrasadas }} atrasada{{ venda.atrasadas > 1 ? 's' : '' }}</b></template></div>
      </div>

      <div v-if="venda.status === 'RETOMADA'" class="aviso" role="status" data-testid="retomada-aviso" style="margin-top: 10px">Aparelho retomado em {{ dmyA(venda.retomada?.em.slice(0, 10) ?? venda.dataVenda) }}<template v-if="venda.retomada?.motivo"> · {{ venda.retomada.motivo }}</template>. O que o cliente já pagou continua no histórico.</div>
      <div v-if="podeAcordo || podeRetomar" class="row" style="gap: 8px; margin-top: 10px; flex-wrap: wrap">
        <button v-if="podeAcordo" class="btn b-out" style="flex: 1" data-acordo @click="acordando = true">{{ ehCobrador ? 'Pedir acordo' : 'Fazer acordo' }}</button>
        <button v-if="podeRetomar" class="btn b-out" style="flex: 1; color: var(--bad)" data-retomar @click="abrirRetomada">{{ ehCobrador ? 'Pedir retomada' : 'Retomar aparelho' }}</button>
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
        <div class="timeline" style="margin-bottom: 8px"><i v-for="p in venda.parcelas" :key="p.numero" :class="{ p: situacao(p) === 'paga' || situacao(p) === 'acordo', a: situacao(p) === 'atrasada' }" :title="`Parcela ${p.numero}`">{{ p.numero }}</i></div>
        <div class="card list">
          <div v-for="p in venda.parcelas" :key="p.numero" class="li" :data-parcela="p.numero">
            <span class="mid"><span class="t">{{ p.numero }}ª · {{ dmy(p.vencimento) }}<template v-if="p.vencimentoOriginal"> (era {{ dmy(p.vencimentoOriginal) }})</template></span><span class="s">{{ fmt(p.valor) }}<template v-if="p.pago > 0 && p.falta > 0"> · já pagou {{ fmt0(p.pago) }}</template></span></span>
            <span class="chip" :class="{ 'c-ok': situacao(p) === 'paga', 'c-bad': situacao(p) === 'atrasada', 'c-neu': situacao(p) === 'aberta' || situacao(p) === 'acordo' }">{{ situacao(p) }}</span>
            <button v-if="ehCobrador && situacao(p) !== 'paga' && situacao(p) !== 'acordo' && venda.status === 'ATIVA'" class="btn b-ghost b-sm" :data-desconto="p.numero" @click="descontando = { numero: p.numero, falta: p.falta, vencimento: p.vencimento }">Desconto</button>
            <button v-if="podeReceber && situacao(p) !== 'paga' && situacao(p) !== 'acordo'" class="btn b-ok b-sm" :data-receber="p.numero" @click="emit('receber', p.numero)">Recebi</button>
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

  <PedirDescontoForm :aberto="descontando !== null" alvo="VENDA" :operacao="venda ? { id: venda.id, cliente: venda.cliente.nome, descricao: venda.aparelho.modelo } : null" :parcela="descontando" @fechar="descontando = null" @feito="aoPedirDesconto" />
  <AcordoForm :aberto="acordando" alvo="VENDA" :operacao="venda ? { id: venda.id, cliente: venda.cliente.nome, descricao: venda.aparelho.modelo, saldo: venda.falta } : null" @fechar="acordando = false" @feito="aoFazerAcordo" />

  <Sheet :aberto="retomando" @fechar="retomando = false">
    <template v-if="venda">
      <h3>{{ ehCobrador ? 'Pedir a retomada do aparelho?' : 'Retomar o aparelho?' }}</h3>
      <div class="small">{{ venda.aparelho.modelo }} · {{ venda.cliente.nome }} · {{ venda.atrasadas }} parcela{{ venda.atrasadas > 1 ? 's' : '' }} atrasada{{ venda.atrasadas > 1 ? 's' : '' }}</div>
      <p v-if="ehCobrador" class="small" style="margin: 10px 0">O administrador decide. Enquanto ele não responder, nada muda na venda.</p>
      <p v-else class="small" style="margin: 10px 0">A venda sai das cobranças e do "a receber", e o aparelho volta pro estoque como disponível. O que o cliente já pagou continua no histórico. Não dá para desfazer.</p>
      <form style="display: flex; flex-direction: column; gap: 14px" @submit.prevent="confirmarRetomada">
        <div class="field"><label for="mRetomada">{{ ehCobrador ? 'Por que pedir a retomada?' : 'Motivo (opcional)' }}</label><div class="inp"><input id="mRetomada" v-model="motivoRetomada" maxlength="500" placeholder="Ex.: cliente sumiu" /></div></div>
        <div v-if="erroRetomada" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erroRetomada }}</div>
        <button class="btn b-bad b-block" type="submit" :disabled="enviandoRetomada || (ehCobrador && motivoRetomada.trim().length < 3)">{{ enviandoRetomada ? 'Enviando…' : ehCobrador ? 'Pedir retomada' : 'Retomar aparelho' }}</button>
      </form>
    </template>
  </Sheet>
</template>
