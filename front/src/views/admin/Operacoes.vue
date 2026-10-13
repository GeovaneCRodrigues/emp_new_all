<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { carregarCadeia, PAGINA_CHEIA } from '@/api/paginar'
import RestanteDaLista from '@/components/RestanteDaLista.vue'
import { useRoute, useRouter } from 'vue-router'
import { ErroApi } from '@/api/clientes'
import type { EmprestimoApi, ResumoEmprestimosApi } from '@/api/emprestimos'
import { emprestimosApi, vendasApi } from '@/api/recursos'
import type { ResumoVendasApi, VendaApi } from '@/api/vendas'
import Abas from '@/components/Abas.vue'
import CampoBusca from '@/components/CampoBusca.vue'
import RecebimentoFluxo from '@/components/RecebimentoFluxo.vue'
import EmprestimoCard from '@/components/EmprestimoCard.vue'
import EmprestimoFicha from '@/components/EmprestimoFicha.vue'
import EmprestimoForm from '@/components/EmprestimoForm.vue'
import Icon from '@/components/Icon.vue'
import Seg from '@/components/Seg.vue'
import VendaCard from '@/components/VendaCard.vue'
import VendaFicha from '@/components/VendaFicha.vue'
import { useApp } from '@/composables/useApp'
import { useBusca } from '@/composables/useBusca'
import { fmt0 } from '@/domain/format'
import { misturarOperacoes, somarResumos } from '@/domain/operacoes'

const route = useRoute()
const router = useRouter()
const { sessao } = useApp()

const ehAdmin = computed(() => sessao.value.perfil === 'ADMIN')
const aba = ref<'todos' | 'iphone' | 'emp'>(ehAdmin.value ? 'todos' : 'iphone') // o vendedor só tem iPhones
const filtro = ref('ATIVA')
const { busca } = useBusca(() => carregar())

// ---- iPhones: vem da API ----
const vendas = ref<VendaApi[]>([])
const total = ref(0)
const resumo = ref<ResumoVendasApi | null>(null)
const carregando = ref(true)
const erro = ref('')
const ficha = ref<VendaApi | null>(null)
const fluxo = ref<InstanceType<typeof RecebimentoFluxo> | null>(null)

/** Depois de um recebimento: recarrega a lista, o resumo e a ficha aberta. */
async function aposMudar() {
  await Promise.all([carregar(), carregarResumo(), carregarEmp(), carregarResumoEmp()])
  if (ficha.value) ficha.value = await vendasApi.obter(sessao.value, ficha.value.id).catch(() => null)
  if (fichaEmp.value) fichaEmp.value = await emprestimosApi.obter(sessao.value, fichaEmp.value.id).catch(() => null)
}

let pedido = 0
async function carregar() {
  const meu = ++pedido
  carregando.value = true
  erro.value = ''
  const [status, termo, s] = [filtro.value, busca.value.trim() || undefined, sessao.value] // fixa os filtros desta carga
  const { primeira, fim } = carregarCadeia({
    buscar: (p) => vendasApi.listar(s, { status, busca: termo, pagina: p, limite: PAGINA_CHEIA }),
    ativo: () => meu === pedido, mostrados: () => vendas.value.length,
    aplicar: (r, p) => { vendas.value = p === 1 ? r.itens : [...vendas.value, ...r.itens]; total.value = r.total },
  })
  fim.catch((e) => { if (meu === pedido) erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar as vendas.' }).finally(() => { if (meu === pedido) carregando.value = false })
  await primeira.catch(() => undefined)
}
async function carregarResumo() {
  try { resumo.value = await vendasApi.resumo(sessao.value) } catch { /* os números ficam em branco */ }
}
watch(filtro, () => carregar())
onBeforeUnmount(() => { pedido++; pedidoEmp++ }) // sair da tela cancela o que ainda está chegando
/** /operacoes?novo=emprestimo (vindo do botão "Novo"): abre a aba de empréstimos já com o formulário. */
function abrirNovoEmprestimo() {
  if (route.query.novo !== 'emprestimo' || !ehAdmin.value) return
  aba.value = 'emp'
  // vindo de uma proposta de indicador (Equipe › Aceitar e lançar): o formulário abre com o que ele pediu
  const q = route.query
  const n = (v: unknown) => (Number(v) > 0 ? Number(v) : undefined)
  inicialEmp.value = n(q.proposta) ? { propostaId: n(q.proposta), clienteId: n(q.cliente), indicadorId: n(q.indicador), capital: n(q.capital), n: n(q.n) } : null
  formEmp.value = true
  router.replace({ path: route.path, query: {} })
}
watch(() => route.query.novo, abrirNovoEmprestimo)
onMounted(async () => {
  carregar(); carregarResumo()
  abrirNovoEmprestimo()
  if (ehAdmin.value && aba.value === 'todos') { carregarEmp(); carregarResumoEmp() }
  // /operacoes?venda=ID abre a ficha (é para onde a "venda feita" manda)
  const id = Number(route.query.venda)
  if (id) ficha.value = await vendasApi.obter(sessao.value, id).catch(() => null)
})

const filtrosIphone = [{ id: 'ATIVA', label: 'Em andamento' }, { id: 'ATRASO', label: 'Com atraso' }, { id: 'QUITADA', label: 'Quitadas' }, { id: 'RETOMADA', label: 'Retomadas' }]

// ---- Empréstimos: vem da API ----
const filtroEmp = ref('ATIVA')
const { busca: buscaEmp } = useBusca(() => carregarEmp())
const emps = ref<EmprestimoApi[]>([])
const totalEmp = ref(0)
const resumoEmp = ref<ResumoEmprestimosApi | null>(null)
const carregandoEmp = ref(false)
const erroEmp = ref('')
const fichaEmp = ref<EmprestimoApi | null>(null)
const formEmp = ref(false)
const inicialEmp = ref<{ propostaId?: number; clienteId?: number; indicadorId?: number; capital?: number; n?: number } | null>(null)
let pedidoEmp = 0
async function carregarEmp() {
  const meu = ++pedidoEmp
  carregandoEmp.value = true; erroEmp.value = ''
  const [status, termo, s] = [filtroEmp.value, buscaEmp.value.trim() || undefined, sessao.value] // fixa os filtros desta carga
  const { primeira, fim } = carregarCadeia({
    buscar: (p) => emprestimosApi.listar(s, { status, busca: termo, pagina: p, limite: PAGINA_CHEIA }),
    ativo: () => meu === pedidoEmp, mostrados: () => emps.value.length,
    aplicar: (r, p) => { emps.value = p === 1 ? r.itens : [...emps.value, ...r.itens]; totalEmp.value = r.total },
  })
  fim.catch((e) => { if (meu === pedidoEmp) erroEmp.value = e instanceof ErroApi ? e.message : 'Não consegui carregar os empréstimos.' }).finally(() => { if (meu === pedidoEmp) carregandoEmp.value = false })
  await primeira.catch(() => undefined)
}
async function carregarResumoEmp() { try { resumoEmp.value = await emprestimosApi.resumo(sessao.value) } catch { /* os números ficam em branco */ } }
watch(filtroEmp, () => carregarEmp())
// ---- Todos: as duas listas juntas, com uma busca e um filtro só (valem para as duas) ----
const buscaTodos = computed({ get: () => busca.value, set: (t: string) => { busca.value = t; buscaEmp.value = t } })
const filtroTodos = computed({ get: () => filtro.value, set: (f: string) => { filtro.value = f; filtroEmp.value = f } })
const todos = computed(() => misturarOperacoes(vendas.value, emps.value))
const resumoTodos = computed(() => somarResumos(resumo.value, resumoEmp.value))
const carregandoTodos = computed(() => carregando.value || carregandoEmp.value)
watch(aba, (a) => {
  if (!ehAdmin.value || a === 'iphone') return
  if (a === 'todos') { // "Retomadas" só existe em iPhone; o resto das duas abas passa a ser o mesmo
    if (filtro.value === 'RETOMADA') filtro.value = 'ATIVA'
    filtroEmp.value = filtro.value
    buscaEmp.value = busca.value
  }
  if (!emps.value.length && !carregandoEmp.value) { carregarEmp(); carregarResumoEmp() }
})
async function aoSalvarEmp(e: EmprestimoApi) { formEmp.value = false; inicialEmp.value = null; filtroEmp.value = 'ATIVA'; await Promise.all([carregarEmp(), carregarResumoEmp()]); fichaEmp.value = e }
const filtrosEmp = [{ id: 'ATIVA', label: 'Em andamento' }, { id: 'ATRASO', label: 'Com atraso' }, { id: 'QUITADA', label: 'Quitados' }]

// só o admin tem empréstimos; o vendedor só vê as vendas dele
const abas = computed(() => [
  ...(ehAdmin.value ? [{ id: 'todos', label: 'Todos', icon: 'layers' }] : []),
  { id: 'iphone', label: 'iPhones', icon: 'smartphone', n: resumo.value ? undefined : undefined },
  ...(ehAdmin.value ? [{ id: 'emp', label: 'Empréstimos', icon: 'landmark' }] : []),
])
</script>

<template>
  <Abas v-if="ehAdmin" v-model="aba" :itens="abas" />

  <template v-if="ehAdmin && aba === 'todos'">
    <div class="resumo3" data-testid="resumo-todos">
      <div><div class="lbl">A receber</div><div class="val num">{{ resumoTodos ? fmt0(resumoTodos.aReceber) : '—' }}</div></div>
      <div><div class="lbl">Capital na rua</div><div class="val num">{{ resumoTodos ? fmt0(resumoTodos.capitalNaRua) : '—' }}</div></div>
      <div><div class="lbl">Lucro por vir</div><div class="val num" style="color: var(--ok)">{{ resumoTodos ? fmt0(resumoTodos.lucroPorVir) : '—' }}</div></div>
    </div>
    <div class="row" style="gap: 8px"><div style="flex: 1; min-width: 0"><CampoBusca v-model="buscaTodos" placeholder="Cliente, aparelho ou indicador" rotulo="Buscar operação" /></div><button class="btn b-pri" @click="formEmp = true"><Icon name="plus" small />Empréstimo</button></div>
    <Seg v-model="filtroTodos" :itens="filtrosEmp" />
    <div v-if="erro || erroEmp" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro || erroEmp }}</span><button class="btn b-ghost b-sm" @click="aposMudar()">Tentar de novo</button></div>
    <div class="fones" data-testid="lista-todos">
      <template v-for="i in todos" :key="i.chave">
        <VendaCard v-if="i.tipo === 'venda'" :v="i.v" @abrir="ficha = $event" />
        <EmprestimoCard v-else :e="i.e" @abrir="fichaEmp = $event" />
      </template>
      <div v-if="!todos.length && !carregandoTodos && !erro && !erroEmp" class="card empty">{{ busca.trim() ? 'Nada encontrado nesta lista.' : 'Nada por aqui.' }}</div>
      <div v-if="carregandoTodos && !todos.length" class="card empty">Carregando…</div>
    </div>
    <RestanteDaLista :mostrados="vendas.length" :total="total" :carregando="carregando" :parado="!!erro" />
    <RestanteDaLista :mostrados="emps.length" :total="totalEmp" :carregando="carregandoEmp" :parado="!!erroEmp" />
  </template>

  <template v-else-if="aba === 'iphone'">
    <div class="resumo3">
      <div><div class="lbl">A receber</div><div class="val num">{{ resumo ? fmt0(resumo.aReceber) : '—' }}</div></div>
      <template v-if="ehAdmin">
        <div><div class="lbl">Capital na rua</div><div class="val num">{{ resumo ? fmt0(resumo.capitalNaRua ?? 0) : '—' }}</div></div>
        <div><div class="lbl">Lucro por vir</div><div class="val num" style="color: var(--ok)">{{ resumo ? fmt0(resumo.lucroPorVir ?? 0) : '—' }}</div></div>
      </template>
    </div>
    <CampoBusca v-model="busca" placeholder="Cliente, aparelho ou indicador" rotulo="Buscar venda" />
    <Seg v-model="filtro" :itens="filtrosIphone" />
    <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar()">Tentar de novo</button></div>
    <div class="fones">
      <VendaCard v-for="v in vendas" :key="v.id" :v="v" @abrir="ficha = $event" />
      <div v-if="!vendas.length && !carregando && !erro" class="card empty">{{ busca.trim() ? 'Nada encontrado nesta lista.' : 'Nenhuma venda aqui.' }}</div>
      <div v-if="carregando && !vendas.length" class="card empty">Carregando…</div>
    </div>
    <RestanteDaLista :mostrados="vendas.length" :total="total" :carregando="carregando" :parado="!!erro" />
  </template>

  <template v-else>
    <div class="resumo3">
      <div><div class="lbl">A receber</div><div class="val num">{{ resumoEmp ? fmt0(resumoEmp.aReceber) : '—' }}</div></div>
      <div><div class="lbl">Capital na rua</div><div class="val num">{{ resumoEmp ? fmt0(resumoEmp.capitalNaRua ?? 0) : '—' }}</div></div>
      <div><div class="lbl">Lucro por vir</div><div class="val num" style="color: var(--ok)">{{ resumoEmp ? fmt0(resumoEmp.lucroPorVir ?? 0) : '—' }}</div></div>
    </div>
    <div class="row" style="gap: 8px"><div style="flex: 1; min-width: 0"><CampoBusca v-model="buscaEmp" placeholder="Cliente ou indicador" rotulo="Buscar empréstimo" /></div><button class="btn b-pri" @click="formEmp = true"><Icon name="plus" small />Empréstimo</button></div>
    <Seg v-model="filtroEmp" :itens="filtrosEmp" />
    <div v-if="erroEmp" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erroEmp }}</span><button class="btn b-ghost b-sm" @click="carregarEmp()">Tentar de novo</button></div>
    <div class="fones">
      <EmprestimoCard v-for="e in emps" :key="e.id" :e="e" @abrir="fichaEmp = $event" />
      <div v-if="!emps.length && !carregandoEmp && !erroEmp" class="card empty">{{ buscaEmp.trim() ? 'Nada encontrado nesta lista.' : 'Nenhum empréstimo aqui.' }}</div>
      <div v-if="carregandoEmp && !emps.length" class="card empty">Carregando…</div>
    </div>
    <RestanteDaLista :mostrados="emps.length" :total="totalEmp" :carregando="carregandoEmp" :parado="!!erroEmp" />
  </template>

  <VendaFicha :venda="ficha" @fechar="ficha = null" @receber="(p) => ficha && fluxo?.iniciar('VENDA', ficha.id, p)" @recibo="(id) => fluxo?.abrirRecibo(id)" @desfazer="(id) => fluxo?.desfazer(id)" @mudou="aposMudar" />
  <EmprestimoFicha :emprestimo="fichaEmp" @fechar="fichaEmp = null" @mudou="aposMudar" @receber="(p) => fichaEmp && fluxo?.iniciar('EMPRESTIMO', fichaEmp.id, p)" @recibo="(id) => fluxo?.abrirRecibo(id)" @desfazer="(id) => fluxo?.desfazer(id)" />
  <EmprestimoForm :aberto="formEmp" :inicial="inicialEmp" @fechar="formEmp = false; inicialEmp = null" @salvo="aoSalvarEmp" />
  <RecebimentoFluxo ref="fluxo" @mudou="aposMudar" />
</template>
