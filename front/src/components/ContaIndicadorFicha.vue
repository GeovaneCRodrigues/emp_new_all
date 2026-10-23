<script setup lang="ts">
import { ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { ContaIndicadorApi, TipoLinhaContaApi } from '@/api/contaIndicador'
import { contaIndicadorApi } from '@/api/recursos'
import { useApp } from '@/composables/useApp'
import { dmy, fmt } from '@/domain/format'
import Icon from './Icon.vue'
import LancarEnvioForm from './LancarEnvioForm.vue'
import Sheet from './Sheet.vue'

/** A conta de um indicador com a loja: o saldo, os totais e o extrato (o que ele cobrou, o que enviou e o que emprestou da conta dele). */
const props = defineProps<{ indicador: { id: number; nome: string } | null }>()
const emit = defineEmits<{ fechar: []; mudou: [] }>()
const { sessao } = useApp()

const conta = ref<ContaIndicadorApi | null>(null)
const carregando = ref(false)
const erro = ref('')
const lancando = ref(false)

async function carregar() {
  if (!props.indicador) return
  carregando.value = true; erro.value = ''
  try { conta.value = await contaIndicadorApi.ver(sessao.value, props.indicador.id) }
  catch (e) { erro.value = e instanceof ErroApi ? e.message : 'Não consegui abrir a conta.' }
  finally { carregando.value = false }
}
watch(() => props.indicador, (i) => { conta.value = null; if (i) carregar() })

const ROTULO: Record<TipoLinhaContaApi, { icone: string; sinal: '+' | '−'; cor: string }> = {
  COBROU: { icone: 'arrow-down-left', sinal: '+', cor: 'var(--bad)' },
  ENVIOU: { icone: 'arrow-up-right', sinal: '−', cor: 'var(--ok)' },
  EMPRESTIMO: { icone: 'hand-coins', sinal: '−', cor: 'var(--ok)' },
}
/** "ele deve", "a loja deve a ele" ou "em dia" */
const situacao = (saldo: number) => (saldo > 0.004 ? 'deve à loja' : saldo < -0.004 ? 'a loja deve a ele' : 'em dia')

function aoLancar(c: ContaIndicadorApi) { conta.value = c; lancando.value = false; emit('mudou') }
</script>

<template>
  <Sheet :aberto="indicador !== null" @fechar="emit('fechar')">
    <template v-if="indicador">
      <h3>Conta de {{ indicador.nome }}</h3>
      <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
      <div v-else-if="carregando && !conta" class="empty">Carregando…</div>
      <template v-else-if="conta">
        <div class="card pad" style="margin-top: 12px; background: var(--elevated)" data-testid="conta-saldo">
          <div class="lbl">Saldo com a loja</div>
          <div class="val num">{{ fmt(Math.abs(conta.saldo)) }}</div>
          <div class="small">{{ situacao(conta.saldo) }}</div>
        </div>
        <div class="resumo3" style="margin-top: 12px">
          <div><div class="lbl">Cobrou dos clientes</div><div class="val num">{{ fmt(conta.cobrou) }}</div></div>
          <div><div class="lbl">Enviou à loja</div><div class="val num">{{ fmt(conta.enviou) }}</div></div>
          <div><div class="lbl">Pagou empréstimos</div><div class="val num">{{ fmt(conta.emprestou) }}</div></div>
        </div>
        <button class="btn b-pri b-block" style="margin-top: 12px" data-lancar-envio @click="lancando = true"><Icon name="plus" small />Lançar envio</button>
        <div class="card list" style="margin-top: 12px" data-testid="conta-extrato">
          <div v-for="l in conta.itens" :key="l.chave" class="li" :data-lancamento="l.tipo" style="cursor: default">
            <span class="wa" style="width: 32px; height: 32px" :style="l.tipo === 'COBROU' ? 'background: var(--bad-soft); color: var(--bad)' : ''"><Icon :name="ROTULO[l.tipo].icone" small /></span>
            <span class="mid"><span class="t" style="display: block">{{ l.titulo }}</span><span class="s" style="display: block">{{ dmy(l.data) }} · {{ l.sub }}</span></span>
            <b class="num" :style="{ color: ROTULO[l.tipo].cor }">{{ ROTULO[l.tipo].sinal }} {{ fmt(l.valor) }}</b>
          </div>
          <div v-if="!conta.itens.length" class="empty">Nada na conta ainda.</div>
        </div>
        <div class="small" style="margin-top: 8px">+ é dinheiro de cliente que ficou com ele; − é o que ele já mandou para a loja ou o que pagou de empréstimo.</div>
      </template>
      <LancarEnvioForm :aberto="lancando" :indicador="indicador" :saldo="conta?.saldo ?? 0" @fechar="lancando = false" @feito="aoLancar" />
    </template>
  </Sheet>
</template>
