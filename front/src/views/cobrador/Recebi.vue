<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { carregarCadeia, PAGINA_CHEIA } from '@/api/paginar'
import RestanteDaLista from '@/components/RestanteDaLista.vue'
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
const carregando = ref(true)
const erro = ref('')

const abas = [{ id: 'atrasadas', label: 'Atrasadas' }, { id: 'hoje', label: 'Esta semana' }, { id: 'proximas', label: 'Próximas' }]

let pedido = 0
async function carregar() {
  const meu = ++pedido
  carregando.value = true; erro.value = ''
  const { primeira, fim } = carregarCadeia({
    buscar: (p) => recebimentosApi.cobrancas(sessao.value, { aba: aba.value, busca: busca.value.trim() || undefined, pagina: p, limite: PAGINA_CHEIA }),
    ativo: () => meu === pedido, mostrados: () => itens.value.length,
    aplicar: (r, p) => { itens.value = p === 1 ? r.itens : [...itens.value, ...r.itens]; total.value = r.total; if (p === 1) atualizar(sessao.value) },
  })
  fim.catch((e) => { if (meu === pedido) erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar as parcelas.' }).finally(() => { if (meu === pedido) carregando.value = false })
  await primeira.catch(() => undefined)
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
  <label class="busca"><Icon name="search" small /><input v-model="busca" placeholder="Cliente ou indicador" aria-label="Buscar cliente ou indicador" /></label>
  <Seg v-model="aba as string" :itens="abas" />
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar()">Tentar de novo</button></div>
  <div class="card list">
    <CobrancaLinha v-for="c in itens" :key="chave(c)" :c="c" @abrir="fichas?.abrir(c.tipo, c.operacaoId)" @receber="fichas?.receber(c.tipo, c.operacaoId, c.parcela)" @recibo="fichas?.recibo($event)" />
    <div v-if="!itens.length && !carregando && !erro" class="empty">{{ busca.trim() ? 'Ninguém com esse nome nesta lista.' : 'Nada aqui.' }}</div>
    <div v-if="carregando && !itens.length" class="empty">Carregando…</div>
  </div>
  <RestanteDaLista :mostrados="itens.length" :total="total" :carregando="carregando" :parado="!!erro" />
  <FichasOperacao ref="fichas" @mudou="carregar()" />
</template>
