<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { CaixaApi, FechamentoApi } from '@/api/fechamentos'
import { fechamentosApi } from '@/api/recursos'
import FichasOperacao from '@/components/FichasOperacao.vue'
import Sheet from '@/components/Sheet.vue'
import { useApp } from '@/composables/useApp'
import { useToast } from '@/composables/useToast'
import { dmy, fmt } from '@/domain/format'

/** O caixa do dia do cobrador: o que recebeu por forma, os recibos e o "Fechar o dia" (o administrador confere depois). */
const { sessao } = useApp()
const { mostrar } = useToast()
const fichas = ref<InstanceType<typeof FichasOperacao> | null>(null)

const caixa = ref<CaixaApi | null>(null)
const anteriores = ref<FechamentoApi[]>([])
const carregando = ref(true)
const erro = ref('')
const confirmando = ref(false)
const enviando = ref(false)
const NOME_FORMA = { PIX: 'Pix', DINHEIRO: 'Dinheiro', CARTAO: 'Cartão' } as const

async function carregar() {
  erro.value = ''
  try {
    const [c, h] = await Promise.all([fechamentosApi.hoje(sessao.value), fechamentosApi.listar(sessao.value, { limite: 10 })])
    caixa.value = c
    anteriores.value = h.itens.filter((f) => f.data !== c.data)
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Não consegui abrir o caixa.'
  } finally {
    carregando.value = false
  }
}
onMounted(carregar)

const fechado = computed(() => caixa.value?.fechamento ?? null)
async function fechar() {
  if (enviando.value) return
  enviando.value = true
  try {
    await fechamentosApi.fechar(sessao.value)
    confirmando.value = false
    mostrar('Dia fechado. O administrador vai conferir.')
  } catch (e) {
    mostrar(e instanceof ErroApi ? e.message : 'Não consegui fechar o dia.')
    confirmando.value = false
  } finally {
    enviando.value = false
    await carregar()
  }
}
</script>

<template>
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar">Tentar de novo</button></div>
  <div v-if="carregando" class="card empty">Carregando…</div>
  <template v-else-if="caixa">
    <section class="hero">
      <div class="lbl">Meu caixa · {{ dmy(caixa.data) }}</div>
      <div><div class="lbl">Total do dia</div><div class="big disp num" data-testid="caixa-total">{{ fmt(caixa.total) }}</div></div>
    </section>
    <div class="resumo3" data-testid="caixa-formas">
      <div><div class="lbl">Dinheiro na mão</div><div class="val num" data-testid="caixa-dinheiro">{{ fmt(caixa.dinheiro) }}</div></div>
      <div><div class="lbl">Pix</div><div class="val num" data-testid="caixa-pix">{{ fmt(caixa.pix) }}</div></div>
      <div><div class="lbl">Cartão</div><div class="val num" data-testid="caixa-cartao">{{ fmt(caixa.cartao) }}</div></div>
    </div>

    <div v-if="fechado" class="card pad" data-testid="dia-fechado" style="display: flex; flex-direction: column; gap: 4px">
      <span class="chip" :class="fechado.status === 'CONFERIDO' ? 'c-ok' : 'c-warn'" style="align-self: flex-start">{{ fechado.status === 'CONFERIDO' ? 'conferido' : 'esperando conferência' }}</span>
      <div class="val">Dia fechado com {{ fmt(fechado.total) }}</div>
      <div class="small">{{ fechado.status === 'CONFERIDO' ? `Conferido por ${fechado.conferidoPor ?? 'o administrador'}.` : 'Entregue o dinheiro ao administrador. Se esquecer de lançar algo, peça para ele reabrir o dia.' }}</div>
    </div>
    <button v-else class="btn b-pri b-block" data-fechar @click="confirmando = true">Fechar o dia</button>

    <div class="sec-t"><h2>O que recebi hoje</h2><span class="small">{{ caixa.recebimentos.length }}</span></div>
    <div class="card list" data-testid="recebimentos-do-dia">
      <div v-for="r in caixa.recebimentos" :key="r.transacaoId" class="li" style="cursor: default" :data-recebimento="r.transacaoId">
        <div class="mid"><div class="t">{{ r.cliente }}</div><div class="s">{{ r.referencia }} · {{ NOME_FORMA[r.forma] }} · recibo {{ r.numero }}</div></div>
        <b class="num">{{ fmt(r.valor) }}</b>
        <button class="btn b-out b-sm" @click="fichas?.recibo(r.transacaoId)">Recibo</button>
      </div>
      <div v-if="!caixa.recebimentos.length" class="empty">Você ainda não recebeu nada hoje.</div>
    </div>

    <template v-if="anteriores.length">
      <div class="sec-t"><h2>Dias anteriores</h2></div>
      <div class="card list" data-testid="dias-anteriores">
        <div v-for="f in anteriores" :key="f.id" class="li" style="cursor: default">
          <div class="mid"><div class="t">{{ dmy(f.data) }}</div><div class="s">dinheiro {{ fmt(f.totalDinheiro) }} · Pix {{ fmt(f.totalPix) }} · cartão {{ fmt(f.totalCartao) }}</div></div>
          <span class="chip" :class="f.status === 'CONFERIDO' ? 'c-ok' : 'c-warn'">{{ f.status === 'CONFERIDO' ? 'conferido' : 'esperando' }}</span>
        </div>
      </div>
    </template>

    <Sheet :aberto="confirmando" @fechar="confirmando = false">
      <h3>Fechar o dia?</h3>
      <div class="dl card pad" style="margin-top: 12px">
        <div><div class="lbl">Dinheiro</div><div class="val num">{{ fmt(caixa.dinheiro) }}</div></div>
        <div><div class="lbl">Pix</div><div class="val num">{{ fmt(caixa.pix) }}</div></div>
        <div><div class="lbl">Cartão</div><div class="val num">{{ fmt(caixa.cartao) }}</div></div>
        <div><div class="lbl">Total</div><div class="val num">{{ fmt(caixa.total) }}</div></div>
      </div>
      <p class="small" style="margin: 10px 0">Depois de fechar, você não recebe nem desfaz nada hoje. O administrador confere esses valores.</p>
      <button class="btn b-pri b-block" :disabled="enviando" @click="fechar">{{ enviando ? 'Fechando…' : 'Fechar o dia' }}</button>
    </Sheet>
  </template>
  <FichasOperacao ref="fichas" @mudou="carregar" />
</template>
