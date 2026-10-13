<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { CaixaLojaApi, CategoriaMovimentoApi, LancamentoApi, MovimentoApi } from '@/api/caixa'
import { caixaApi } from '@/api/recursos'
import Icon from '@/components/Icon.vue'
import LancamentoCaixaForm from '@/components/LancamentoCaixaForm.vue'
import { useApp } from '@/composables/useApp'
import { mesNome } from '@/domain/cronograma'
import { dmy, dmyA, fmt, fmt0 } from '@/domain/format'

/** O caixa da loja: o saldo e o extrato do que entrou e saiu (só o administrador). */
const { sessao } = useApp()

const caixa = ref<CaixaLojaApi | null>(null)
const itens = ref<MovimentoApi[]>([])
const pagina = ref(1)
const carregando = ref(true)
const erro = ref('')
const formAberto = ref(false)
const editando = ref<LancamentoApi | null>(null)

// uma resposta antiga que chega atrasada não pode sobrescrever a mais nova
let pedido = 0
async function carregar(mais = false) {
  const meu = ++pedido
  carregando.value = true; erro.value = ''
  try {
    const p = mais ? pagina.value + 1 : 1
    const r = await caixaApi.ver(sessao.value, { pagina: p, limite: 25 })
    if (meu !== pedido) return
    caixa.value = r; itens.value = mais ? [...itens.value, ...r.itens] : r.itens; pagina.value = p
  } catch (e) {
    if (meu === pedido) erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar o caixa.'
  } finally {
    if (meu === pedido) carregando.value = false
  }
}
onMounted(() => carregar())

const restantes = computed(() => (caixa.value ? Math.max(0, caixa.value.total - itens.value.length) : 0))
const ICONE: Record<CategoriaMovimentoApi, string> = {
  RECEBIMENTO: 'arrow-down-left', ENTRADA_VENDA: 'arrow-down-left', TRANSFERENCIA: 'arrow-down-left', APORTE: 'arrow-down-left',
  REPASSE: 'arrow-up-right', RETIRADA: 'arrow-up-right', DESPESA: 'arrow-up-right', EMPRESTIMO: 'arrow-up-right', COMPRA: 'arrow-up-right',
}

function novo() { editando.value = null; formAberto.value = true }
function editar(m: MovimentoApi) {
  if (m.manualId === null || (m.categoria !== 'APORTE' && m.categoria !== 'RETIRADA' && m.categoria !== 'DESPESA')) return
  // o título de um lançamento manual é a própria observação (ou o nome do tipo, quando não tem)
  const sem = m.titulo === m.sub
  editando.value = { id: m.manualId, tipo: m.categoria, valor: m.valor, data: m.data, obs: sem ? null : m.titulo }
  formAberto.value = true
}
async function aposSalvar() { formAberto.value = false; await carregar() }
</script>

<template>
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar()">Tentar de novo</button></div>

  <template v-if="caixa">
    <div class="hero" style="gap: 8px">
      <div class="between" style="gap: 8px; align-items: flex-start">
        <div class="lbl">Saldo em caixa</div>
        <button class="btn b-sm" style="background: rgba(255, 255, 255, 0.16); color: #fff" data-testid="caixa-lancar" @click="novo"><Icon name="plus" small />Lançar</button>
      </div>
      <div class="big disp num" data-testid="caixa-saldo" :style="caixa.saldo < 0 ? 'color: #ffd6cf' : ''">{{ fmt(caixa.saldo) }}</div>
      <div class="row" style="gap: 18px; flex-wrap: wrap">
        <span class="lbl" data-testid="caixa-mes"><span style="text-transform: capitalize">{{ mesNome(caixa.mes) }}</span>: <b style="color: #d8f5c0">+ {{ fmt0(caixa.entrouMes) }}</b> entrou · <b style="color: #ffd6cf">− {{ fmt0(caixa.saiuMes) }}</b> saiu</span>
      </div>
    </div>
    <div v-if="caixa.marcoZero" class="small" data-testid="caixa-marco">Contando a partir de {{ dmyA(caixa.marcoZero) }}, o primeiro aporte ou retirada lançado. O que veio antes não entra na conta.</div>
    <div v-else class="small" data-testid="caixa-sem-marco">Ainda não há aporte nem retirada: o saldo soma tudo. Lance o seu saldo de abertura como um aporte para começar a contar dali.</div>

    <div class="card list" data-testid="caixa-extrato">
      <component
        :is="m.manualId !== null ? 'button' : 'div'" v-for="m in itens" :key="m.chave" class="li" :data-movimento="m.chave" :data-categoria="m.categoria" :type="m.manualId !== null ? 'button' : undefined"
        :aria-label="m.manualId !== null ? `Corrigir ${m.titulo}` : undefined" @click="editar(m)"
      >
        <span class="wa" :style="`width: 32px; height: 32px; ${m.entrada ? '' : 'background: var(--bad-soft); color: var(--bad)'}`"><Icon :name="ICONE[m.categoria]" small /></span>
        <span class="mid"><span class="t" style="display: block">{{ m.titulo }}</span><span class="s" style="display: block">{{ dmy(m.data) }}{{ m.sub ? ` · ${m.sub}` : '' }}</span></span>
        <b class="num" style="white-space: nowrap" :style="{ color: m.entrada ? 'var(--ok)' : 'var(--bad)' }">{{ m.entrada ? '+' : '−' }} {{ fmt(m.valor) }}</b>
      </component>
      <div v-if="!itens.length && !carregando" class="empty">Nada no caixa ainda.</div>
    </div>
    <button v-if="restantes > 0" class="btn b-sub b-block" :disabled="carregando" data-testid="caixa-mais" @click="carregar(true)">{{ carregando ? 'Carregando…' : `Mostrar mais (${restantes})` }}</button>
  </template>
  <div v-else-if="carregando" class="empty">Carregando…</div>

  <LancamentoCaixaForm :aberto="formAberto" :lancamento="editando" @fechar="formAberto = false" @salvo="aposSalvar" @excluido="aposSalvar" />
</template>
