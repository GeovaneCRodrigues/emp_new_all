<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { carregarCadeia, PAGINA_CHEIA } from '@/api/paginar'
import RestanteDaLista from '@/components/RestanteDaLista.vue'
import { ErroApi } from '@/api/clientes'
import type { AbaCobranca, AlvoApi, CobrancaApi, ListaCobrancasApi } from '@/api/recebimentos'
import type { EmprestimoApi } from '@/api/emprestimos'
import type { IndicadorApi } from '@/api/indicadores'
import { emprestimosApi, indicadoresApi, recebimentosApi, vendasApi } from '@/api/recursos'
import type { VendaApi } from '@/api/vendas'
import CampoBusca from '@/components/CampoBusca.vue'
import CobrancaLinha from '@/components/CobrancaLinha.vue'
import RemarcarForm from '@/components/RemarcarForm.vue'
import EmprestimoFicha from '@/components/EmprestimoFicha.vue'
import RecebimentoFluxo from '@/components/RecebimentoFluxo.vue'
import Seg from '@/components/Seg.vue'
import VendaFicha from '@/components/VendaFicha.vue'
import { useApp } from '@/composables/useApp'
import { useAtrasadas } from '@/composables/useAtrasadas'
import { useBusca } from '@/composables/useBusca'
import { fmt } from '@/domain/format'

const { sessao } = useApp()
const { atualizar } = useAtrasadas()

const aba = ref<AbaCobranca>('atrasadas')
/** '' = tudo (iPhones e empréstimos juntos) */
const tipo = ref<'' | AlvoApi>('')
/** '' = todos os indicadores, 'SEM' = sem indicador, ou o id do indicador */
const filtroIndicador = ref('')
const indicadores = ref<IndicadorApi[]>([])
const { busca } = useBusca(() => carregar())
const itens = ref<CobrancaApi[]>([])
const total = ref(0)
const valorTotal = ref(0)
const contagens = ref<ListaCobrancasApi['contagens']>({ atrasadas: 0, hoje: 0, proximas: 0 })
const carregando = ref(true)
const erro = ref('')
const ficha = ref<VendaApi | null>(null)
const fichaEmp = ref<EmprestimoApi | null>(null)
const fluxo = ref<InstanceType<typeof RecebimentoFluxo> | null>(null)

let pedido = 0
async function carregar() {
  const meu = ++pedido
  carregando.value = true; erro.value = ''
  // fixa os filtros desta carga: as páginas seguintes não podem usar um filtro que mudou no meio
  const [a, t, termo, s, ind] = [aba.value, tipo.value, busca.value.trim(), sessao.value, filtroIndicador.value]
  const { primeira, fim } = carregarCadeia({
    buscar: (p) => recebimentosApi.cobrancas(s, { aba: a, ...(t ? { tipo: t } : {}), ...(termo ? { busca: termo } : {}), ...(ind ? { indicador: ind === 'SEM' ? ('SEM' as const) : Number(ind) } : {}), pagina: p, limite: PAGINA_CHEIA }),
    ativo: () => meu === pedido, mostrados: () => itens.value.length,
    aplicar: (r, p) => { itens.value = p === 1 ? r.itens : [...itens.value, ...r.itens]; total.value = r.total; valorTotal.value = r.valorTotal; contagens.value = r.contagens },
  })
  fim.catch((e) => { if (meu === pedido) erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar as cobranças.' }).finally(() => { if (meu === pedido) carregando.value = false })
  await primeira.catch(() => undefined)
}
watch([aba, tipo, filtroIndicador], () => carregar())
onMounted(() => {
  carregar(); atualizar(sessao.value)
  indicadoresApi.listar(sessao.value).then((l) => { indicadores.value = l }).catch(() => undefined) // sem a lista o filtro fica só com "Todos" e "Sem indicador"
})
onBeforeUnmount(() => { pedido++ }) // sair da tela cancela o que ainda está chegando

const abas = computed(() => [
  { id: 'atrasadas', label: 'Atrasadas' + (contagens.value.atrasadas ? ` · ${contagens.value.atrasadas}` : '') },
  { id: 'hoje', label: 'Esta semana' + (contagens.value.hoje ? ` · ${contagens.value.hoje}` : '') },
  { id: 'proximas', label: 'Próximas' + (contagens.value.proximas ? ` · ${contagens.value.proximas}` : '') },
  { id: 'recebidas', label: 'Recebidas' },
])
const legenda = computed(() => ({ atrasadas: 'em atraso', hoje: 'vence nos próximos 7 dias', proximas: 'nos próximos 45 dias', recebidas: 'nos últimos 30 dias' })[aba.value])

const tipos = [{ id: '', label: 'Tudo' }, { id: 'VENDA', label: 'iPhones' }, { id: 'EMPRESTIMO', label: 'Empréstimos' }]
async function abrirFicha(c: CobrancaApi) {
  if (c.tipo === 'VENDA') ficha.value = await vendasApi.obter(sessao.value, c.operacaoId).catch(() => null)
  else fichaEmp.value = await emprestimosApi.obter(sessao.value, c.operacaoId).catch(() => null)
}
const remarcar = ref<InstanceType<typeof RemarcarForm> | null>(null)
const receber = (c: CobrancaApi) => fluxo.value?.iniciar(c.tipo, c.operacaoId, c.parcela)
/** Depois de um recebimento: recarrega a lista e as fichas abertas. */
async function aposMudar() {
  await carregar()
  if (ficha.value) ficha.value = await vendasApi.obter(sessao.value, ficha.value.id).catch(() => null)
  if (fichaEmp.value) fichaEmp.value = await emprestimosApi.obter(sessao.value, fichaEmp.value.id).catch(() => null)
}
const verRecibo = (id: number) => fluxo.value?.abrirRecibo(id)
</script>

<template>
  <CampoBusca v-model="busca" placeholder="Buscar cliente ou indicador" />
  <Seg v-model="tipo as string" :itens="tipos" data-testid="filtro-tipo" />
  <div class="inp" style="max-width: 280px"><select v-model="filtroIndicador" aria-label="Filtrar por indicador" data-testid="cob-filtro-indicador"><option value="">Todos os indicadores</option><option value="SEM">Sem indicador</option><option v-for="i in indicadores" :key="i.id" :value="String(i.id)">{{ i.nome }}</option></select></div>
  <Seg v-model="aba as string" :itens="abas" />
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar()">Tentar de novo</button></div>
  <div class="card">
    <div class="totbar">
      <span class="small">{{ total }} {{ total === 1 ? 'parcela' : 'parcelas' }} {{ legenda }}</span>
      <b class="num" data-testid="cobrancas-total" style="font-size: 16px" :style="{ color: aba === 'atrasadas' ? 'var(--bad)' : aba === 'recebidas' ? 'var(--ok)' : 'var(--strong)' }">{{ fmt(valorTotal) }}</b>
    </div>
    <div class="list">
      <CobrancaLinha v-for="c in itens" :key="c.tipo + c.operacaoId + '-' + c.parcela" :c="c" :recebida="aba === 'recebidas'" editavel @abrir="abrirFicha" @receber="receber" @recibo="verRecibo" @editar="remarcar?.abrir($event)" />
      <div v-if="!itens.length && !carregando && !erro" class="empty">{{ busca.trim() ? 'Ninguém com esse nome nesta lista.' : 'Nada aqui.' }}</div>
      <div v-if="carregando && !itens.length" class="empty">Carregando…</div>
    </div>
  </div>
  <RestanteDaLista :mostrados="itens.length" :total="total" :carregando="carregando" :parado="!!erro" />

  <RemarcarForm ref="remarcar" @feito="aposMudar" />
  <VendaFicha :venda="ficha" @fechar="ficha = null" @receber="(p) => ficha && fluxo?.iniciar('VENDA', ficha.id, p)" @recibo="verRecibo" @desfazer="(id) => fluxo?.desfazer(id)" @mudou="aposMudar" />
  <EmprestimoFicha :emprestimo="fichaEmp" @fechar="fichaEmp = null" @mudou="aposMudar" @receber="(p, q) => fichaEmp && fluxo?.iniciar('EMPRESTIMO', fichaEmp.id, p, q)" @recibo="verRecibo" @desfazer="(id) => fluxo?.desfazer(id)" />
  <RecebimentoFluxo ref="fluxo" @mudou="aposMudar" />
</template>
