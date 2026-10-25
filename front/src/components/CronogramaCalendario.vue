<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { AlvoApi, CobrancaApi } from '@/api/recebimentos'
import type { EmprestimoApi } from '@/api/emprestimos'
import type { IndicadorApi } from '@/api/indicadores'
import { emprestimosApi, indicadoresApi, recebimentosApi, vendasApi } from '@/api/recursos'
import type { VendaApi } from '@/api/vendas'
import AvisarRecebiForm from '@/components/AvisarRecebiForm.vue'
import CobrancaLinha from '@/components/CobrancaLinha.vue'
import EmprestimoFicha from '@/components/EmprestimoFicha.vue'
import Icon from '@/components/Icon.vue'
import RecebimentoFluxo from '@/components/RecebimentoFluxo.vue'
import RemarcarForm from '@/components/RemarcarForm.vue'
import Seg from '@/components/Seg.vue'
import VendaFicha from '@/components/VendaFicha.vue'
import { useApp } from '@/composables/useApp'
import { useAtrasadas } from '@/composables/useAtrasadas'
import { usePulso } from '@/composables/usePulso'
import { gradeDoMes, kfmt, mesLabel, mesNome, resumoDoMes, somaYm } from '@/domain/cronograma'
import { fmt0 } from '@/domain/format'

/**
 * O calendário do mês: as parcelas de iPhones e empréstimos juntas, dia a dia.
 * Serve ao administrador (recebe e abre a ficha) e ao indicador (`indicador`: só vê as dele e AVISA a loja).
 */
const props = defineProps<{ indicador?: boolean }>()
const { sessao, hoje } = useApp()
const { atualizar } = useAtrasadas()

const mes = ref(hoje.value.slice(0, 7))
const tipo = ref<'' | AlvoApi>('')
const busca = ref('')
/** Filtros do administrador: de qual indicador ('' = todos, 'SEM' = sem indicador, ou o id) e qual modalidade de empréstimo. */
const filtroIndicador = ref('')
type Modalidade = 'PARCELADO' | 'JUROS' | 'DIARIA'
/** Vários ao mesmo tempo (multisseleção); nenhum marcado = todas. */
const filtroModalidade = ref<Modalidade[]>([])
/** O que falta receber, o que já foi recebido, ou tudo ('' ). */
const filtroSituacao = ref<'' | 'ABERTAS' | 'RECEBIDAS'>('')
const situacoes = [{ id: '', label: 'Todas' }, { id: 'ABERTAS', label: 'A receber' }, { id: 'RECEBIDAS', label: 'Recebidas' }]
const indicadores = ref<IndicadorApi[]>([])
const podeFiltrar = computed(() => !props.indicador && sessao.value.perfil === 'ADMIN')
const modalidades: { id: Modalidade; label: string }[] = [{ id: 'PARCELADO', label: 'Parcelado' }, { id: 'JUROS', label: 'Só juros' }, { id: 'DIARIA', label: 'Diária' }]
const alternarModalidade = (m: Modalidade) => { filtroModalidade.value = filtroModalidade.value.includes(m) ? filtroModalidade.value.filter((x) => x !== m) : [...filtroModalidade.value, m] }
/** Modalidade só existe em empréstimo: na aba iPhones o filtro some (e não vale). */
const mostraModalidade = computed(() => podeFiltrar.value && tipo.value !== 'VENDA')
const comFiltro = computed(() => podeFiltrar.value && (filtroIndicador.value !== '' || filtroSituacao.value !== '' || (mostraModalidade.value && filtroModalidade.value.length > 0)))
function limparFiltros() { filtroIndicador.value = ''; filtroModalidade.value = []; filtroSituacao.value = '' }
/** O dia escolhido no calendário; sem dia (null) a lista de baixo traz o mês inteiro. */
const dia = ref<string | null>(null)
const itens = ref<CobrancaApi[]>([])
const cortado = ref(false)
/** A busca com que `itens` foi carregado: a lista de baixo só aparece quando bate com o que está digitado (senão mostraria o resultado de antes). */
const buscaDosItens = ref('')
const carregando = ref(true)
const erro = ref('')
const ficha = ref<VendaApi | null>(null)
const fichaEmp = ref<EmprestimoApi | null>(null)
const fluxo = ref<InstanceType<typeof RecebimentoFluxo> | null>(null)
const aviso = ref<InstanceType<typeof AvisarRecebiForm> | null>(null)
const remarcar = ref<InstanceType<typeof RemarcarForm> | null>(null)

// uma resposta antiga que chega atrasada não pode sobrescrever a mais nova
let pedido = 0
async function carregar(silencioso = false) {
  const meu = ++pedido
  if (!silencioso) { carregando.value = true; erro.value = '' }
  try {
    const termo = busca.value.trim()
    const r = await recebimentosApi.cronograma(sessao.value, { mes: mes.value, ...(tipo.value ? { tipo: tipo.value } : {}), ...(termo ? { busca: termo } : {}), ...(podeFiltrar.value && filtroIndicador.value ? { indicador: filtroIndicador.value === 'SEM' ? ('SEM' as const) : Number(filtroIndicador.value) } : {}), ...(podeFiltrar.value && filtroSituacao.value ? { situacao: filtroSituacao.value } : {}), ...(mostraModalidade.value && filtroModalidade.value.length ? { modalidade: [...filtroModalidade.value] } : {}) })
    if (meu !== pedido) return
    itens.value = r.itens; cortado.value = r.cortado; buscaDosItens.value = termo
  } catch (e) {
    if (meu === pedido && !silencioso) erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar o calendário.'
  } finally {
    if (meu === pedido && !silencioso) carregando.value = false
  }
}
let espera: ReturnType<typeof setTimeout> | undefined
watch(busca, () => { dia.value = null; clearTimeout(espera); espera = setTimeout(carregar, 300) }) // digitar uma busca volta para a lista toda
watch([mes, tipo, filtroIndicador, filtroModalidade, filtroSituacao], () => { dia.value = null; itens.value = []; cortado.value = false; carregar() }) // o mês anterior não fica na tela enquanto o novo carrega
onMounted(() => {
  carregar(); if (!props.indicador) atualizar(sessao.value)
  if (podeFiltrar.value) indicadoresApi.listar(sessao.value).then((l) => { indicadores.value = l }).catch(() => undefined) // sem a lista o filtro de indicador fica só com "Todos" e "Sem indicador"
})
onBeforeUnmount(() => clearTimeout(espera))
// o que a loja baixa aparece sozinho (o indicador não recebe: só acompanha)
usePulso(() => { if (props.indicador) return carregar(true) })

const tipos = [{ id: '', label: 'Tudo' }, { id: 'VENDA', label: 'iPhones' }, { id: 'EMPRESTIMO', label: 'Empréstimos' }]
const resumo = computed(() => resumoDoMes(itens.value, hoje.value))
const grade = computed(() => gradeDoMes(mes.value, itens.value, hoje.value))
/** O dia escolhido mostra só o que está a vencer (em aberto); as já pagas ficam atrás de "Mostrar pagas". */
const verPagas = ref(false)
watch(dia, () => { verPagas.value = false })
const itensDoDia = computed(() => grade.value.dias.find((d) => d.iso === dia.value)?.itens ?? [])
const pagasDoDia = computed(() => itensDoDia.value.filter((c) => !aberta(c)).length)
const doDia = computed(() => (verPagas.value ? itensDoDia.value : itensDoDia.value.filter(aberta)))
const comBusca = computed(() => busca.value.trim() !== '')
/** Sem dia escolhido, a lista traz todas as parcelas do mês (ou da busca), agrupadas por dia. Escolher um dia mostra só as dele, mesmo com busca. */
const listaDoMes = computed(() => dia.value === null)
const porDia = computed(() => grade.value.dias.filter((d) => d.itens.length))
const buscaPronta = computed(() => buscaDosItens.value === busca.value.trim())
const clientes = computed(() => new Set(itens.value.map((c) => c.cliente.id)).size)
const doMes = computed(() => itens.value.length)
const naoEhHoje = computed(() => mes.value !== hoje.value.slice(0, 7))
const aberta = (c: CobrancaApi) => c.falta > 0.009
const chaveDe = (c: CobrancaApi) => c.tipo + c.operacaoId + '-' + c.parcela
const rotuloDia = (iso: string) => `${Number(iso.slice(8))} de ${mesNome(iso.slice(0, 7))}`
const plural = (n: number) => `${n} ${n === 1 ? 'parcela' : 'parcelas'}`
const CORES = { bad: 'var(--bad)', warn: 'var(--warn)', dim: 'var(--dim)', ok: 'var(--ok)' } as const
const escolher = (iso: string, qtd: number) => {
  if (qtd || dia.value === iso) dia.value = dia.value === iso ? null : iso; else dia.value = iso
  // em tela grande a lista fica abaixo do calendário, fora da vista: leva até ela
  if (dia.value) nextTick(() => document.querySelector('[data-testid="cron-lista-dia"]')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }))
}

async function abrirFicha(c: CobrancaApi) {
  if (c.tipo === 'VENDA') ficha.value = await vendasApi.obter(sessao.value, c.operacaoId).catch(() => null)
  else fichaEmp.value = await emprestimosApi.obter(sessao.value, c.operacaoId).catch(() => null)
}
const receber = (c: CobrancaApi) => fluxo.value?.iniciar(c.tipo, c.operacaoId, c.parcela)
const verRecibo = (id: number) => fluxo.value?.abrirRecibo(id)
/** Depois de um recebimento: recarrega o mês e as fichas abertas. */
async function aposMudar() {
  await carregar()
  if (ficha.value) ficha.value = await vendasApi.obter(sessao.value, ficha.value.id).catch(() => null)
  if (fichaEmp.value) fichaEmp.value = await emprestimosApi.obter(sessao.value, fichaEmp.value.id).catch(() => null)
}
</script>

<template>
  <Seg v-model="tipo as string" :itens="tipos" data-testid="filtro-tipo" />
  <div v-if="podeFiltrar" class="row" style="gap: 8px; flex-wrap: wrap; align-items: center" data-testid="cron-filtros">
    <div class="inp" style="flex: 1 1 200px; max-width: 280px"><select v-model="filtroIndicador" aria-label="Filtrar por indicador" data-testid="cron-filtro-indicador"><option value="">Todos os indicadores</option><option value="SEM">Sem indicador</option><option v-for="i in indicadores" :key="i.id" :value="String(i.id)">{{ i.nome }}</option></select></div>
    <Seg v-model="filtroSituacao as string" :itens="situacoes" data-testid="cron-filtro-situacao" />
    <div v-if="mostraModalidade" class="pills" role="group" aria-label="Filtrar por modalidade" data-testid="cron-filtro-modalidade">
      <button type="button" class="pill" :class="{ on: !filtroModalidade.length }" :aria-pressed="!filtroModalidade.length" data-modalidade="TODAS" @click="filtroModalidade = []">Todas</button>
      <button v-for="m in modalidades" :key="m.id" type="button" class="pill" :class="{ on: filtroModalidade.includes(m.id) }" :aria-pressed="filtroModalidade.includes(m.id)" :data-modalidade="m.id" @click="alternarModalidade(m.id)">{{ m.label }}</button>
    </div>
    <button v-if="comFiltro" class="btn b-ghost b-sm" data-testid="cron-limpar-filtros" @click="limparFiltros">Limpar filtros</button>
  </div>
  <label class="busca"><Icon name="search" small /><input v-model="busca" :placeholder="indicador ? 'Buscar cliente pelo nome' : 'Buscar cliente ou indicador'" aria-label="Buscar cliente" data-testid="cron-busca" /></label>

  <div class="between" style="gap: 8px">
    <div class="row" style="gap: 6px">
      <button class="btn b-out b-sm" aria-label="Mês anterior" data-testid="cron-mes-ant" @click="mes = somaYm(mes, -1)"><Icon name="chevron-left" small /></button>
      <b data-testid="cron-mes" style="color: var(--strong); font-size: 15px; min-width: 140px; text-align: center; text-transform: capitalize">{{ mesLabel(mes) }}</b>
      <button class="btn b-out b-sm" aria-label="Próximo mês" data-testid="cron-mes-prox" @click="mes = somaYm(mes, 1)"><Icon name="chevron-right" small /></button>
    </div>
    <div class="row" style="gap: 6px">
      <button class="btn b-sm" :class="dia === null ? 'b-pri' : 'b-out'" :aria-pressed="dia === null" data-testid="cron-mes-todo" @click="dia = null">Mês inteiro</button>
      <button v-if="naoEhHoje" class="btn b-ghost b-sm" data-testid="cron-hoje" @click="mes = hoje.slice(0, 7)">Hoje</button>
    </div>
  </div>

  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar()">Tentar de novo</button></div>
  <div v-if="cortado" class="aviso" role="status" data-testid="cron-cortado">Este mês tem parcelas demais para mostrar de uma vez. Use a busca por cliente para ver o resto.</div>

  <div class="resumo3" data-testid="cron-resumo">
    <div><div class="lbl">Previsto</div><div class="val num" data-testid="cron-previsto">{{ fmt0(resumo.previsto) }}</div></div>
    <div><div class="lbl">Recebido</div><div class="val num" data-testid="cron-recebido" style="color: var(--ok)">{{ fmt0(resumo.recebido) }}</div></div>
    <div><div class="lbl">Em atraso</div><div class="val num" data-testid="cron-atrasado" :style="{ color: resumo.atrasado ? 'var(--bad)' : 'var(--strong)' }">{{ fmt0(resumo.atrasado) }}</div></div>
  </div>

  <div class="card pad">
    <div class="cal sem"><span v-for="d in ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']" :key="d">{{ d }}</span></div>
    <div class="cal" data-testid="cron-grade">
      <span v-for="i in grade.vazios" :key="'v' + i"></span>
      <button
        v-for="d in grade.dias" :key="d.iso" type="button" class="d" :class="{ hoje: d.iso === hoje, sel: d.iso === dia }" :data-dia="d.iso" :data-cor="d.cor ?? ''"
        :aria-label="d.itens.length ? `${rotuloDia(d.iso)}: ${plural(d.itens.length)}${d.recebido.n ? `, ${d.recebido.n} com pagamento` : ''}${d.aberto.n ? `, ${d.aberto.n} em aberto` : ''}` : rotuloDia(d.iso)" @click="escolher(d.iso, d.itens.length)"
      >
        <span class="n">{{ d.dia }}</span>
        <template v-if="d.itens.length">
          <span v-if="d.recebido.n" class="b" data-bloco="recebido"><span class="v num" :style="{ color: CORES.ok }">{{ kfmt(d.recebido.valor) }}</span><span class="q">{{ d.recebido.n === 1 ? 'paga' : `${d.recebido.n} pagas` }}</span></span>
          <span v-if="d.aberto.n" class="b" data-bloco="aberto"><span class="v num" :style="{ color: CORES[d.cor!] }">{{ kfmt(d.aberto.valor) }}</span><span class="q">{{ d.aberto.n === 1 ? 'aberta' : `${d.aberto.n} abertas` }}</span></span>
        </template>
      </button>
    </div>
    <div class="small" style="margin-top: 10px">Em cada dia: o de cima (verde) já foi recebido, o de baixo ainda está aberto · vermelho atrasado · laranja vence esta semana</div>
  </div>

  <!-- sem dia escolhido, ou com busca: todas as parcelas do mês (da busca), dia a dia. Com um dia escolhido: só as dele -->
  <div v-if="comBusca && !buscaPronta" class="empty" data-testid="cron-buscando">Buscando…</div>
  <div v-else-if="listaDoMes && !(carregando && !itens.length)" class="card" :data-testid="comBusca ? 'cron-lista-busca' : 'cron-lista-mes'">
    <div class="totbar">
      <b style="color: var(--strong)">{{ doMes ? `${plural(doMes)} em ${mesNome(mes)}` : `Nada em ${mesNome(mes)}` }}</b>
      <span class="small">{{ doMes ? `${clientes} cliente(s)` : comBusca ? 'nenhum cliente com esse nome' : 'nada vence neste mês' }}</span>
    </div>
    <template v-for="g in porDia" :key="g.iso">
      <div class="small" style="padding: 8px 14px 2px; font-weight: 700; color: var(--soft); text-transform: capitalize" :data-grupo-dia="g.iso">{{ rotuloDia(g.iso) }} · {{ plural(g.itens.length) }}</div>
      <div class="list">
        <CobrancaLinha v-for="c in g.itens" :key="chaveDe(c)" :c="c" :recebida="!aberta(c)" :indicador="indicador" :editavel="podeFiltrar" @abrir="abrirFicha" @receber="receber" @recibo="verRecibo" @avisar="aviso?.abrir($event)" @editar="remarcar?.abrir($event)" />
      </div>
    </template>
  </div>
  <div v-else-if="dia" class="card" data-testid="cron-lista-dia">
    <div class="totbar">
      <b style="color: var(--strong)">{{ rotuloDia(dia) }}</b>
      <span class="small">{{ doDia.length ? (verPagas ? plural(doDia.length) : `${doDia.length} a vencer`) : itensDoDia.length ? 'nada a vencer neste dia' : 'nada vence neste dia' }}</span>
    </div>
    <div v-if="pagasDoDia" style="padding: 4px 14px 8px"><button type="button" class="btn b-ghost b-sm" data-testid="cron-dia-pagas" :aria-pressed="verPagas" @click="verPagas = !verPagas">{{ verPagas ? 'Esconder as pagas' : `Mostrar as ${pagasDoDia} já pagas` }}</button></div>
    <div v-if="doDia.length" class="list">
      <CobrancaLinha v-for="c in doDia" :key="chaveDe(c)" :c="c" :recebida="!aberta(c)" :indicador="indicador" :editavel="podeFiltrar" @abrir="abrirFicha" @receber="receber" @recibo="verRecibo" @avisar="aviso?.abrir($event)" @editar="remarcar?.abrir($event)" />
    </div>
  </div>
  <div v-if="carregando && !itens.length && !erro" class="empty">Carregando…</div>

  <template v-if="!indicador">
    <VendaFicha :venda="ficha" @fechar="ficha = null" @receber="(p) => ficha && fluxo?.iniciar('VENDA', ficha.id, p)" @recibo="verRecibo" @desfazer="(id) => fluxo?.desfazer(id)" @mudou="aposMudar" />
    <EmprestimoFicha :emprestimo="fichaEmp" @fechar="fichaEmp = null" @mudou="aposMudar" @receber="(p, q) => fichaEmp && fluxo?.iniciar('EMPRESTIMO', fichaEmp.id, p, q)" @recibo="verRecibo" @desfazer="(id) => fluxo?.desfazer(id)" />
    <RecebimentoFluxo ref="fluxo" @mudou="aposMudar" />
    <RemarcarForm ref="remarcar" @feito="aposMudar" />
  </template>
  <AvisarRecebiForm v-else ref="aviso" @enviado="carregar()" />
</template>
