<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import { recebimentosApi, vendasApi } from '@/api/recursos'
import type { RegistradoApi } from '@/api/recebimentos'
import type { FormaPagamentoApi, VendaApi } from '@/api/vendas'
import { useApp } from '@/composables/useApp'
import { addDia } from '@/domain/datas'
import { dmy, dmyA, fmt, iniciais } from '@/domain/format'
import { calcularRecebimento, descreverEfeitos, ErroRecebimento, falta, vencPadraoResto, type RestoPagamento } from '@/domain/recebimento'
import MoneyInput from './MoneyInput.vue'
import Sheet from './Sheet.vue'

const props = defineProps<{ alvo: { vendaId: number; parcela: number } | null }>()
const emit = defineEmits<{ fechar: []; registrado: [r: RegistradoApi] }>()

const { sessao, hoje } = useApp()
const ehAdmin = computed(() => sessao.value.perfil === 'ADMIN')

const venda = ref<VendaApi | null>(null)
const carregando = ref(false)
const erro = ref('')
const enviando = ref(false)
const f = reactive({ data: '', valor: 0, forma: 'PIX' as FormaPagamentoApi, resto: 'FICA' as RestoPagamento, novoVenc: '' })

const parcela = computed(() => venda.value?.parcelas.find((p) => p.numero === props.alvo?.parcela) ?? null)
const faltaAlvo = computed(() => (parcela.value ? falta({ valor: parcela.value.valor, pago: parcela.value.pago, desconto: parcela.value.desconto }) : 0))

watch(() => props.alvo, async (a) => {
  venda.value = null; erro.value = ''
  if (!a) return
  carregando.value = true
  try {
    venda.value = await vendasApi.obter(sessao.value, a.vendaId)
    const p = venda.value.parcelas.find((x) => x.numero === a.parcela)
    f.data = hoje.value
    f.valor = p ? falta({ valor: p.valor, pago: p.pago, desconto: p.desconto }) : 0
    f.forma = 'PIX'; f.resto = 'FICA'; f.novoVenc = p ? vencPadraoResto(p.vencimento, hoje.value) : ''
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Não consegui abrir a venda.'
  } finally {
    carregando.value = false
  }
}, { immediate: true })

const parcial = computed(() => f.valor > 0 && f.valor < faltaAlvo.value - 0.009)

/** A prévia do que o recebimento vai fazer, com a mesma regra do servidor. */
const previa = computed(() => {
  if (!venda.value || !(f.valor > 0)) return { texto: '', erro: '' }
  try {
    const r = calcularRecebimento(
      venda.value.parcelas.map((p) => ({ id: p.numero, numero: p.numero, vencimento: p.vencimento, vencimentoOriginal: p.vencimentoOriginal, valor: p.valor, desconto: p.desconto, pago: p.pago, quitadaEm: p.quitadaEm })),
      { numero: props.alvo!.parcela, valor: f.valor, data: f.data || hoje.value, hoje: hoje.value, resto: parcial.value ? f.resto : undefined, novoVenc: parcial.value && f.resto === 'FICA' ? f.novoVenc : undefined },
    )
    return { texto: descreverEfeitos(r.efeitos, fmt, dmy), erro: '' }
  } catch (e) {
    return { texto: '', erro: e instanceof ErroRecebimento ? e.message : '' }
  }
})

const opcoesData = computed(() => [{ rotulo: 'Hoje', valor: hoje.value }, { rotulo: 'Ontem', valor: addDia(hoje.value, -1) }])
const opcoesNovaData = computed(() => {
  const p = parcela.value
  const lista = [{ rotulo: `+3 dias`, valor: addDia(hoje.value, 3) }, { rotulo: '+7 dias', valor: addDia(hoje.value, 7) }, { rotulo: '+15 dias', valor: addDia(hoje.value, 15) }]
  return p && p.vencimento > hoje.value ? [{ rotulo: `Manter ${dmy(p.vencimento)}`, valor: p.vencimento }, ...lista] : lista
})

async function confirmar() {
  if (enviando.value || !props.alvo || previa.value.erro || !(f.valor > 0)) return
  enviando.value = true
  erro.value = ''
  try {
    const r = await recebimentosApi.registrar(sessao.value, props.alvo.vendaId, {
      parcela: props.alvo.parcela, valor: f.valor, forma: f.forma, data: f.data || hoje.value,
      ...(parcial.value ? { resto: f.resto, ...(f.resto === 'FICA' ? { novoVencimento: f.novoVenc } : {}) } : {}),
    })
    emit('registrado', r)
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <Sheet :aberto="alvo !== null" @fechar="emit('fechar')">
    <h3>Registrar recebimento</h3>
    <div v-if="carregando" class="empty">Carregando…</div>
    <div v-else-if="!venda || !parcela" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); margin-top: 12px">{{ erro || 'Parcela não encontrada.' }}</div>
    <template v-else>
      <div class="card pad" style="margin-top: 12px; display: flex; gap: 12px; align-items: center; background: var(--elevated)">
        <span class="ini">{{ iniciais(venda.cliente.nome) }}</span>
        <div style="flex: 1; min-width: 0"><div class="val">{{ venda.cliente.nome }}</div><div class="small">{{ venda.aparelho.modelo }} · parcela {{ parcela.numero }}/{{ venda.nParcelas }} · venc. {{ dmy(parcela.vencimento) }}<template v-if="parcela.vencimentoOriginal"> (era {{ dmy(parcela.vencimentoOriginal) }})</template></div></div>
        <div style="text-align: right"><div class="val num">{{ fmt(faltaAlvo) }}</div><div v-if="parcela.pago > 0" class="small">já pagou {{ fmt(parcela.pago) }}</div></div>
      </div>

      <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px" novalidate @submit.prevent="confirmar">
        <div v-if="ehAdmin" class="field">
          <label>Quando recebeu?</label>
          <div class="pills">
            <button v-for="o in opcoesData" :key="o.valor" type="button" class="pill" :class="{ on: f.data === o.valor }" @click="f.data = o.valor">{{ o.rotulo }}</button>
            <div class="inp" style="height: 36px; flex: 1; min-width: 150px"><input id="rData" v-model="f.data" type="date" :min="venda.dataVenda" :max="hoje" style="font-size: 14px" aria-label="Data do recebimento" /></div>
          </div>
        </div>
        <div class="field">
          <label for="rValor">Quanto recebeu?</label>
          <MoneyInput id="rValor" v-model="f.valor" />
          <div class="pills"><button type="button" class="pill" @click="f.valor = faltaAlvo">Valor cheio</button><button type="button" class="pill" @click="f.valor = Math.round(faltaAlvo * 50) / 100">Metade</button></div>
        </div>
        <div class="field"><label>Como pagou?</label><div class="pills"><button v-for="o in ([['PIX', 'Pix'], ['DINHEIRO', 'Dinheiro'], ['CARTAO', 'Cartão']] as const)" :key="o[0]" type="button" class="pill" :class="{ on: f.forma === o[0] }" @click="f.forma = o[0]">{{ o[1] }}</button></div></div>

        <!-- pagou menos: o que fazer com o resto -->
        <div v-if="parcial" class="field" data-testid="resto">
          <div class="lbl">Faltaram {{ fmt(faltaAlvo - f.valor) }}. O que fazer?</div>
          <button type="button" class="opt" :class="{ on: f.resto === 'FICA' }" data-resto="FICA" @click="f.resto = 'FICA'"><span class="radio"></span><span><span class="val" style="display: block">Fica devendo nesta parcela</span><span class="small">A {{ parcela.numero }}ª continua aberta com {{ fmt(faltaAlvo - f.valor) }}</span></span></button>
          <div v-if="f.resto === 'FICA'" class="field" style="padding: 2px 4px 4px 34px">
            <label>Quando ele paga o que falta?</label>
            <div class="pills">
              <button v-for="o in opcoesNovaData" :key="o.valor" type="button" class="pill" :class="{ on: f.novoVenc === o.valor }" @click="f.novoVenc = o.valor">{{ o.rotulo }}</button>
              <div class="inp" style="height: 36px; flex: 1; min-width: 150px"><input v-model="f.novoVenc" type="date" :min="hoje" style="font-size: 14px" aria-label="Nova data do restante" /></div>
            </div>
            <div class="small">{{ f.novoVenc === parcela.vencimento ? 'O vencimento continua o mesmo.' : `A ${parcela.numero}ª passa a vencer ${dmyA(f.novoVenc || hoje)}${parcela.vencimento < hoje ? ' e sai dos atrasados' : ''}.` }}</div>
          </div>
          <button type="button" class="opt" :class="{ on: f.resto === 'DESCONTO' }" :disabled="!ehAdmin" data-resto="DESCONTO" @click="ehAdmin && (f.resto = 'DESCONTO')">
            <span class="radio"></span>
            <span><span class="val" style="display: block">Dar desconto de {{ fmt(faltaAlvo - f.valor) }}</span><span class="small">{{ ehAdmin ? `A ${parcela.numero}ª fica quitada. O desconto sai do seu lucro` : 'Só o administrador dá desconto. Peça a ele.' }}</span></span>
          </button>
        </div>

        <div v-if="previa.texto" class="chip c-pri" style="white-space: normal; line-height: 1.4; padding: 6px 10px" data-testid="previa">{{ previa.texto }}</div>
        <div v-else-if="previa.erro" class="chip c-bad" style="white-space: normal; line-height: 1.4; padding: 6px 10px" role="alert">{{ previa.erro }}</div>
        <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
        <button class="btn b-ok b-block" type="submit" :disabled="enviando || !!previa.erro || !(f.valor > 0)">{{ enviando ? 'Registrando…' : 'Confirmar recebimento' }}</button>
      </form>
    </template>
  </Sheet>
</template>
