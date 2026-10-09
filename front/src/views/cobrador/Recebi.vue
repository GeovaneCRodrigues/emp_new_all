<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { AbaCobranca, CobrancaApi } from '@/api/recebimentos'
import { recebimentosApi } from '@/api/recursos'
import CobrancaLinha from '@/components/CobrancaLinha.vue'
import FichasOperacao from '@/components/FichasOperacao.vue'
import Icon from '@/components/Icon.vue'
import Seg from '@/components/Seg.vue'
import { useApp } from '@/composables/useApp'
import { useAtrasadas } from '@/composables/useAtrasadas'

/** O botão central do cobrador: achar a parcela que o cliente acabou de pagar e dar baixa (busca pelo nome). */
const { sessao } = useApp()
const { atualizar } = useAtrasadas()
const fichas = ref<InstanceType<typeof FichasOperacao> | null>(null)

const aba = ref<AbaCobranca>('atrasadas')
const busca = ref('')
const itens = ref<CobrancaApi[]>([])
const total = ref(0)
const pagina = ref(1)
const carregando = ref(true)
const erro = ref('')

const abas = [{ id: 'atrasadas', label: 'Atrasadas' }, { id: 'hoje', label: 'Esta semana' }, { id: 'proximas', label: 'Próximas' }]

let pedido = 0
async function carregar(mais = false) {
  const meu = ++pedido
  carregando.value = true; erro.value = ''
  try {
    const p = mais ? pagina.value + 1 : 1
    const r = await recebimentosApi.cobrancas(sessao.value, { aba: aba.value, busca: busca.value.trim() || undefined, pagina: p, limite: 20 })
    if (meu !== pedido) return
    itens.value = mais ? [...itens.value, ...r.itens] : r.itens
    total.value = r.total; pagina.value = p
    atualizar(sessao.value)
  } catch (e) {
    if (meu === pedido) erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar as parcelas.'
  } finally {
    if (meu === pedido) carregando.value = false
  }
}
let espera: ReturnType<typeof setTimeout> | undefined
watch(aba, () => carregar())
watch(busca, () => { clearTimeout(espera); espera = setTimeout(() => carregar(), 300) })
onBeforeUnmount(() => clearTimeout(espera))
onMounted(() => carregar())
const chave = (c: CobrancaApi) => c.tipo + c.operacaoId + '-' + c.parcela
</script>

<template>
  <div class="small">Quem acabou de pagar? Procure pelo nome e toque em <b>Recebi</b>.</div>
  <label class="busca"><Icon name="search" small /><input v-model="busca" placeholder="Nome do cliente" aria-label="Buscar cliente" /></label>
  <Seg v-model="aba as string" :itens="abas" />
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar()">Tentar de novo</button></div>
  <div class="card list">
    <CobrancaLinha v-for="c in itens" :key="chave(c)" :c="c" @abrir="fichas?.abrir(c.tipo, c.operacaoId)" @receber="fichas?.receber(c.tipo, c.operacaoId, c.parcela)" @recibo="fichas?.recibo($event)" />
    <div v-if="!itens.length && !carregando && !erro" class="empty">{{ busca.trim() ? 'Ninguém com esse nome nesta lista.' : 'Nada aqui.' }}</div>
    <div v-if="carregando && !itens.length" class="empty">Carregando…</div>
  </div>
  <button v-if="itens.length < total" class="btn b-out" :disabled="carregando" @click="carregar(true)">{{ carregando ? 'Carregando…' : 'Carregar mais' }}</button>
  <FichasOperacao ref="fichas" @mudou="carregar()" />
</template>
