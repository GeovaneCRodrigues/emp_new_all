<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { DetalheRepasseApi } from '@/api/repasses'
import { repassesApi } from '@/api/recursos'
import RepasseOps from '@/components/RepasseOps.vue'
import { useApp } from '@/composables/useApp'
import { dmyA, fmt } from '@/domain/format'

/** O repasse do indicador: o que já pode receber, o que já recebeu, o que vai liberar e a parte dele em cada cliente. */
const { sessao } = useApp()
const dados = ref<DetalheRepasseApi | null>(null)
const carregando = ref(true)
const erro = ref('')
const NOME_FORMA = { PIX: 'Pix', DINHEIRO: 'Dinheiro', TRANSFERENCIA: 'Transferência' } as const

onMounted(async () => {
  try { dados.value = await repassesApi.detalhe(sessao.value, sessao.value.indicadorId ?? -1) }
  catch (e) { erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar o repasse.' }
  finally { carregando.value = false }
})
</script>

<template>
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
  <template v-if="dados">
    <div class="kpi3" data-testid="resumo-repasse">
      <div><div class="lbl">Pra receber</div><div class="val num" data-testid="a-receber">{{ fmt(dados.resumo.aPagar) }}</div></div>
      <div><div class="lbl">Já recebi</div><div class="val num" data-testid="ja-recebi">{{ fmt(dados.resumo.pago) }}</div></div>
      <div><div class="lbl">Vai liberar</div><div class="val num" data-testid="vai-liberar">{{ fmt(dados.resumo.vaiLiberar) }}</div></div>
    </div>
    <div class="small" style="margin-top: 8px">A sua parte só começa a liberar depois que o capital da loja volta. A loja paga quando acertar com você.</div>

    <div class="sec-t"><h2>Por cliente</h2></div>
    <div class="card" data-testid="por-cliente"><RepasseOps :operacoes="dados.operacoes" /><div v-if="!dados.operacoes.length" class="empty">Nenhuma operação sua ainda.</div></div>

    <div class="sec-t"><h2>Repasses recebidos</h2></div>
    <div class="card list" data-testid="repasses-recebidos">
      <div v-for="r in dados.repasses" :key="r.id" class="li" style="cursor: default">
        <div class="mid"><div class="t">{{ dmyA(r.data) }}</div><div class="s">{{ NOME_FORMA[r.forma] }}<template v-if="r.obs"> · {{ r.obs }}</template></div></div>
        <b class="num">{{ fmt(r.valor) }}</b>
      </div>
      <div v-if="!dados.repasses.length" class="empty">Nenhum repasse recebido ainda.</div>
    </div>
  </template>
  <div v-else-if="carregando" class="card empty">Carregando…</div>
</template>
