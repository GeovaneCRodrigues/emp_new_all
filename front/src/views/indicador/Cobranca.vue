<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { carregarCadeia, PAGINA_CHEIA } from '@/api/paginar'
import RestanteDaLista from '@/components/RestanteDaLista.vue'
import { ErroApi } from '@/api/clientes'
import type { AbaCobranca, AlvoApi, CobrancaApi, ListaCobrancasApi } from '@/api/recebimentos'
import { recebimentosApi } from '@/api/recursos'
import AvisarRecebiForm from '@/components/AvisarRecebiForm.vue'
import CobrancaLinha from '@/components/CobrancaLinha.vue'
import Seg from '@/components/Seg.vue'
import { useApp } from '@/composables/useApp'
import { useAtrasadas } from '@/composables/useAtrasadas'
import { usePulso } from '@/composables/usePulso'
import { fmt } from '@/domain/format'

/** As parcelas dos clientes do indicador: ele cobra pelo WhatsApp e acompanha. Quem dá a baixa é a loja. */
const { sessao } = useApp()
const { atualizar } = useAtrasadas()

const aba = ref<AbaCobranca>('atrasadas')
const tipo = ref<'' | AlvoApi>('')
const itens = ref<CobrancaApi[]>([])
const total = ref(0)
const valorTotal = ref(0)
const contagens = ref<ListaCobrancasApi['contagens']>({ atrasadas: 0, hoje: 0, proximas: 0 })
const carregando = ref(true)
const erro = ref('')
const aviso = ref<InstanceType<typeof AvisarRecebiForm> | null>(null)

let pedido = 0
async function carregar(silencioso = false) {
  const meu = ++pedido
  if (!silencioso) { carregando.value = true; erro.value = '' }
  const [a, t, s] = [aba.value, tipo.value, sessao.value] // fixa os filtros desta carga
  const { primeira, fim } = carregarCadeia({
    buscar: (p) => recebimentosApi.cobrancas(s, { aba: a, ...(t ? { tipo: t } : {}), pagina: p, limite: PAGINA_CHEIA }),
    ativo: () => meu === pedido, mostrados: () => itens.value.length,
    aplicar: (r, p) => { itens.value = p === 1 ? r.itens : [...itens.value, ...r.itens]; total.value = r.total; valorTotal.value = r.valorTotal; contagens.value = r.contagens },
  })
  fim.catch((e) => { if (meu === pedido && !silencioso) erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar as cobranças.' }).finally(() => { if (meu === pedido && !silencioso) carregando.value = false })
  await primeira.catch(() => undefined)
}
watch([aba, tipo], () => carregar())
onMounted(() => { carregar(); atualizar(sessao.value) })
// a loja confirma ou recusa o "Recebi" e a lista muda sozinha, sem o indicador precisar sair e voltar
usePulso(() => carregar(true))
onBeforeUnmount(() => { pedido++ }) // sair da tela cancela o que ainda está chegando

const abas = computed(() => [
  { id: 'atrasadas', label: 'Atrasadas' + (contagens.value.atrasadas ? ` · ${contagens.value.atrasadas}` : '') },
  { id: 'hoje', label: 'Esta semana' + (contagens.value.hoje ? ` · ${contagens.value.hoje}` : '') },
  { id: 'proximas', label: 'Próximas' + (contagens.value.proximas ? ` · ${contagens.value.proximas}` : '') },
  { id: 'recebidas', label: 'Pagas' },
])
const legenda = computed(() => ({ atrasadas: 'em atraso', hoje: 'vence nos próximos 7 dias', proximas: 'nos próximos 45 dias', recebidas: 'nos últimos 30 dias' })[aba.value])
const tipos = [{ id: '', label: 'Tudo' }, { id: 'VENDA', label: 'iPhones' }, { id: 'EMPRESTIMO', label: 'Empréstimos' }]
</script>

<template>
  <Seg v-model="tipo as string" :itens="tipos" data-testid="filtro-tipo" />
  <Seg v-model="aba as string" :itens="abas" />
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar()">Tentar de novo</button></div>
  <div class="card">
    <div class="totbar">
      <span class="small">{{ total }} {{ total === 1 ? 'parcela' : 'parcelas' }} {{ legenda }}</span>
      <b class="num" data-testid="cobrancas-total" style="font-size: 16px" :style="{ color: aba === 'atrasadas' ? 'var(--bad)' : aba === 'recebidas' ? 'var(--ok)' : 'var(--strong)' }">{{ fmt(valorTotal) }}</b>
    </div>
    <div class="list">
      <CobrancaLinha v-for="c in itens" :key="c.tipo + c.operacaoId + '-' + c.parcela" :c="c" :recebida="aba === 'recebidas'" indicador @avisar="aviso?.abrir($event)" />
      <div v-if="!itens.length && !carregando && !erro" class="empty">Nada aqui.</div>
      <div v-if="carregando && !itens.length" class="empty">Carregando…</div>
    </div>
  </div>
  <RestanteDaLista :mostrados="itens.length" :total="total" :carregando="carregando" :parado="!!erro" />
  <AvisarRecebiForm ref="aviso" @enviado="carregar()" />
</template>
