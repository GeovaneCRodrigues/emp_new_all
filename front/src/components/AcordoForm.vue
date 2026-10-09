<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { AlvoApi } from '@/api/recebimentos'
import { acordosApi, aprovacoesApi } from '@/api/recursos'
import { useApp } from '@/composables/useApp'
import { useToast } from '@/composables/useToast'
import { distribuirAcordo, problemaDoAcordo, vencimentosAcordo } from '@/domain/acordo'
import { addDia } from '@/domain/datas'
import { arred2, dmy, fmt } from '@/domain/format'
import MoneyInput from './MoneyInput.vue'
import Sheet from './Sheet.vue'
import DateField from './DateField.vue'

/**
 * Acordo: renegociar o que falta em parcelas novas. O administrador faz direto; o cobrador propõe e o administrador aprova.
 * As parcelas abertas viram "encerradas por acordo" (ficam só com o que já foi pago) e as novas continuam a numeração.
 */
const props = defineProps<{ aberto: boolean; alvo: AlvoApi; operacao: { id: number; cliente: string; descricao: string; saldo: number } | null }>()
const emit = defineEmits<{ fechar: []; feito: [] }>()
const { sessao, hoje } = useApp()
const { mostrar } = useToast()

const ehCobrador = computed(() => sessao.value.perfil === 'COBRADOR')
const ATALHOS = [1, 2, 3, 4, 6, 10, 12]
const f = reactive({ valor: 0, n: 3, primeira: '', motivo: '' })
const erro = ref('')
const enviando = ref(false)

watch(() => props.aberto, (a) => {
  if (!a || !props.operacao) return
  Object.assign(f, { valor: props.operacao.saldo, n: 3, primeira: addDia(hoje.value, 7), motivo: '' })
  erro.value = ''
})

const valores = computed(() => distribuirAcordo(arred2(f.valor), f.n))
const datas = computed(() => (f.primeira && f.n >= 1 && f.n <= 120 ? vencimentosAcordo(f.primeira, f.n) : []))
const dia = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '')
const diferenca = computed(() => arred2(f.valor - (props.operacao?.saldo ?? 0)))
const problema = computed(() => {
  const p = problemaDoAcordo({ valorTotal: f.valor, parcelas: f.n, primeiraParcela: f.primeira }, hoje.value)
  if (p) return p
  if (ehCobrador.value && (f.motivo.trim().length < 3 || f.motivo.trim().length > 500)) return 'Explique o motivo do pedido (de 3 a 500 letras).'
  return ''
})

async function confirmar() {
  if (enviando.value || problema.value || !props.operacao) return
  enviando.value = true; erro.value = ''
  try {
    const base = { valorTotal: arred2(f.valor), parcelas: f.n, primeiraParcela: f.primeira }
    if (ehCobrador.value) {
      await aprovacoesApi.pedirAcordo(sessao.value, { alvo: props.alvo, operacaoId: props.operacao.id, ...base, motivo: f.motivo.trim() })
      mostrar('Pedido de acordo enviado. O administrador vai responder.')
    } else {
      await acordosApi.fazer(sessao.value, props.alvo, props.operacao.id, { ...base, ...(f.motivo.trim() ? { motivo: f.motivo.trim() } : {}) })
      mostrar('Acordo feito.')
    }
    emit('feito')
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <Sheet :aberto="aberto" @fechar="emit('fechar')">
    <template v-if="operacao">
      <h3>{{ ehCobrador ? 'Pedir acordo' : 'Fazer acordo' }}</h3>
      <div class="small">{{ operacao.cliente }} · {{ operacao.descricao }}</div>
      <div class="card pad" style="margin-top: 12px; background: var(--elevated)" data-testid="acordo-saldo"><div class="lbl">O cliente deve hoje</div><div class="val num">{{ fmt(operacao.saldo) }}</div></div>

      <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px" novalidate @submit.prevent="confirmar">
        <div class="field"><label for="aValor">Valor do acordo</label><MoneyInput id="aValor" v-model="f.valor" />
          <div v-if="f.valor > 0 && diferenca !== 0" class="small" data-testid="acordo-diferenca">{{ diferenca < 0 ? `Desconto de ${fmt(-diferenca)} sobre o que ele deve` : `Juros do acordo de ${fmt(diferenca)} sobre o que ele deve` }}</div>
        </div>
        <div class="field"><label for="aParcelas">Em quantas parcelas?</label>
          <div class="pills"><button v-for="q in ATALHOS" :key="q" type="button" class="pill" :class="{ on: f.n === q }" @click="f.n = q">{{ q }}x</button></div>
          <div class="inp"><input id="aParcelas" v-model.number="f.n" type="number" min="1" max="120" step="1" inputmode="numeric" /></div>
        </div>
        <div class="field"><label for="aData">Data da 1ª parcela</label><DateField id="aData" v-model="f.primeira" :min="hoje" /><div class="small">As outras vencem mês a mês, no mesmo dia.</div></div>
        <div class="field"><label for="aMotivo">{{ ehCobrador ? 'Por que pedir o acordo?' : 'Motivo (opcional)' }}</label><div class="inp"><input id="aMotivo" v-model="f.motivo" maxlength="500" :placeholder="ehCobrador ? 'Ex.: cliente perdeu o emprego' : 'Ex.: renegociação a pedido do cliente'" /></div></div>

        <div v-if="valores.length && datas.length" class="card list" data-testid="lista-acordo" style="max-height: 220px; overflow: auto">
          <div v-for="(v, i) in valores" :key="i" class="li" style="cursor: default" :data-parcela-acordo="i + 1">
            <div class="mid"><div class="t">{{ i + 1 }}ª · {{ dmy(datas[i]) }}</div><div class="s">{{ dia(datas[i]) }}</div></div>
            <b class="num">{{ fmt(v) }}</b>
          </div>
        </div>
        <div class="small">As parcelas que ele ainda devia ficam encerradas por este acordo (o que já foi pago continua no histórico). Não dá para desfazer.</div>

        <div v-if="problema" class="small" role="status" style="color: var(--soft)" data-testid="problema-acordo">{{ problema }}</div>
        <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
        <button class="btn b-pri b-block" type="submit" :disabled="enviando || !!problema">{{ enviando ? 'Salvando…' : ehCobrador ? 'Pedir acordo' : 'Fazer acordo' }}</button>
      </form>
    </template>
  </Sheet>
</template>
