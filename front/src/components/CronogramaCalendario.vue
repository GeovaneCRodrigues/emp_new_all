<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { AlvoApi, CobrancaApi } from '@/api/recebimentos'
import type { EmprestimoApi } from '@/api/emprestimos'
import { emprestimosApi, recebimentosApi, vendasApi } from '@/api/recursos'
import type { VendaApi } from '@/api/vendas'
import AvisarRecebiForm from '@/components/AvisarRecebiForm.vue'
import CobrancaLinha from '@/components/CobrancaLinha.vue'
import EmprestimoFicha from '@/components/EmprestimoFicha.vue'
import Icon from '@/components/Icon.vue'
import RecebimentoFluxo from '@/components/RecebimentoFluxo.vue'
import Seg from '@/components/Seg.vue'
import VendaFicha from '@/components/VendaFicha.vue'
import { useApp } from '@/composables/useApp'
import { useAtrasadas } from '@/composables/useAtrasadas'
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
const dia = ref<string | null>(hoje.value)
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

// uma resposta antiga que chega atrasada não pode sobrescrever a mais nova
let pedido = 0
async function carregar() {
  const meu = ++pedido
  carregando.value = true; erro.value = ''
  try {
    const termo = busca.value.trim()
    const r = await recebimentosApi.cronograma(sessao.value, { mes: mes.value, ...(tipo.value ? { tipo: tipo.value } : {}), ...(termo ? { busca: termo } : {}) })
    if (meu !== pedido) return
    itens.value = r.itens; cortado.value = r.cortado; buscaDosItens.value = termo
  } catch (e) {
    if (meu === pedido) erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar o calendário.'
  } finally {
    if (meu === pedido) carregando.value = false
  }
}
let espera: ReturnType<typeof setTimeout> | undefined
watch(busca, () => { clearTimeout(espera); espera = setTimeout(carregar, 300) })
watch([mes, tipo], () => { dia.value = mes.value === hoje.value.slice(0, 7) ? hoje.value : null; carregar() })
onMounted(() => { carregar(); if (!props.indicador) atualizar(sessao.value) })
onBeforeUnmount(() => clearTimeout(espera))

const tipos = [{ id: '', label: 'Tudo' }, { id: 'VENDA', label: 'iPhones' }, { id: 'EMPRESTIMO', label: 'Empréstimos' }]
const resumo = computed(() => resumoDoMes(itens.value, hoje.value))
const grade = computed(() => gradeDoMes(mes.value, itens.value, hoje.value))
const doDia = computed(() => grade.value.dias.find((d) => d.iso === dia.value)?.itens ?? [])
const comBusca = computed(() => busca.value.trim() !== '')
const buscaPronta = computed(() => buscaDosItens.value === busca.value.trim())
const clientes = computed(() => new Set(itens.value.map((c) => c.cliente.id)).size)
const doMes = computed(() => itens.value.length)
const naoEhHoje = computed(() => mes.value !== hoje.value.slice(0, 7))
const aberta = (c: CobrancaApi) => c.falta > 0.009
const chaveDe = (c: CobrancaApi) => c.tipo + c.operacaoId + '-' + c.parcela
const rotuloDia = (iso: string) => `${Number(iso.slice(8))} de ${mesNome(iso.slice(0, 7))}`
const plural = (n: number) => `${n} ${n === 1 ? 'parcela' : 'parcelas'}`
const CORES = { bad: 'var(--bad)', warn: 'var(--warn)', dim: 'var(--dim)', ok: 'var(--ok)' } as const
const escolher = (iso: string, qtd: number) => { if (qtd || dia.value === iso) dia.value = dia.value === iso ? null : iso; else dia.value = iso }

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
  <label class="busca"><Icon name="search" small /><input v-model="busca" placeholder="Buscar cliente pelo nome" aria-label="Buscar cliente" data-testid="cron-busca" /></label>

  <div class="between" style="gap: 8px">
    <div class="row" style="gap: 6px">
      <button class="btn b-out b-sm" aria-label="Mês anterior" data-testid="cron-mes-ant" @click="mes = somaYm(mes, -1)"><Icon name="chevron-left" small /></button>
      <b data-testid="cron-mes" style="color: var(--strong); font-size: 15px; min-width: 140px; text-align: center; text-transform: capitalize">{{ mesLabel(mes) }}</b>
      <button class="btn b-out b-sm" aria-label="Próximo mês" data-testid="cron-mes-prox" @click="mes = somaYm(mes, 1)"><Icon name="chevron-right" small /></button>
    </div>
    <button v-if="naoEhHoje" class="btn b-ghost b-sm" data-testid="cron-hoje" @click="mes = hoje.slice(0, 7)">Hoje</button>
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
        :aria-label="d.itens.length ? `${rotuloDia(d.iso)}: ${plural(d.itens.length)}` : rotuloDia(d.iso)" @click="escolher(d.iso, d.itens.length)"
      >
        <span class="n">{{ d.dia }}</span>
        <template v-if="d.itens.length">
          <span class="v num" :style="{ color: CORES[d.cor!] }">{{ kfmt(d.total) }}</span>
          <span class="q">{{ plural(d.itens.length) }}</span>
        </template>
      </button>
    </div>
    <div class="small" style="margin-top: 10px">Vermelho atrasado · laranja vence esta semana · verde pago</div>
  </div>

  <!-- com busca, embaixo vêm todas as parcelas do mês desse cliente, não só as do dia -->
  <div v-if="comBusca && !buscaPronta" class="empty" data-testid="cron-buscando">Buscando…</div>
  <div v-else-if="comBusca" class="card" data-testid="cron-lista-busca">
    <div class="totbar">
      <b style="color: var(--strong)">{{ doMes ? `${plural(doMes)} em ${mesNome(mes)}` : `Nada em ${mesNome(mes)}` }}</b>
      <span class="small">{{ doMes ? `${clientes} cliente(s)` : 'nenhum cliente com esse nome' }}</span>
    </div>
    <div v-if="doMes" class="list">
      <CobrancaLinha v-for="c in itens" :key="chaveDe(c)" :c="c" :recebida="!aberta(c)" :indicador="indicador" @abrir="abrirFicha" @receber="receber" @recibo="verRecibo" @avisar="aviso?.abrir($event)" />
    </div>
  </div>
  <div v-else-if="dia" class="card" data-testid="cron-lista-dia">
    <div class="totbar">
      <b style="color: var(--strong)">{{ rotuloDia(dia) }}</b>
      <span class="small">{{ doDia.length ? plural(doDia.length) : 'nada vence neste dia' }}</span>
    </div>
    <div v-if="doDia.length" class="list">
      <CobrancaLinha v-for="c in doDia" :key="chaveDe(c)" :c="c" :recebida="!aberta(c)" :indicador="indicador" @abrir="abrirFicha" @receber="receber" @recibo="verRecibo" @avisar="aviso?.abrir($event)" />
    </div>
  </div>
  <div v-if="carregando && !itens.length && !erro" class="empty">Carregando…</div>

  <template v-if="!indicador">
    <VendaFicha :venda="ficha" @fechar="ficha = null" @receber="(p) => ficha && fluxo?.iniciar('VENDA', ficha.id, p)" @recibo="verRecibo" @desfazer="(id) => fluxo?.desfazer(id)" @mudou="aposMudar" />
    <EmprestimoFicha :emprestimo="fichaEmp" @fechar="fichaEmp = null" @mudou="aposMudar" @receber="(p) => fichaEmp && fluxo?.iniciar('EMPRESTIMO', fichaEmp.id, p)" @recibo="verRecibo" @desfazer="(id) => fluxo?.desfazer(id)" />
    <RecebimentoFluxo ref="fluxo" @mudou="aposMudar" />
  </template>
  <AvisarRecebiForm v-else ref="aviso" @enviado="carregar()" />
</template>
