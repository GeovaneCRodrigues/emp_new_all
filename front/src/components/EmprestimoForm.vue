<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ErroApi, type ClienteApi } from '@/api/clientes'
import type { EmprestimoApi, ModalidadeApi, PeriodicidadeApi } from '@/api/emprestimos'
import { clientesApi, emprestimosApi, indicadoresApi } from '@/api/recursos'
import { useApp } from '@/composables/useApp'
import { planoEmprestimo, primeiroVenc } from '@/domain/calc'
import { addDia } from '@/domain/datas'
import { FREQ, pctDaParcela, pctDoJuro, pctDoTotal } from '@/domain/emprestimo'
import { arred2, dmy, fmt } from '@/domain/format'
import Icon from './Icon.vue'
import MoneyInput from './MoneyInput.vue'
import Sheet from './Sheet.vue'
import DateField from './DateField.vue'

/**
 * Novo empréstimo em 3 passos (plano de 09/10):
 *  1. cliente e valor (+ data do empréstimo e indicação);
 *  2. como paga: parcelado ou só juros, de quanto em quanto tempo, quantas parcelas e os juros;
 *  3. datas e confirmar: 1º vencimento, a lista de todas as parcelas e o resumo.
 */
const props = defineProps<{ aberto: boolean }>()
const emit = defineEmits<{ fechar: []; salvo: [e: EmprestimoApi] }>()
const { sessao, hoje } = useApp()

const PASSOS = ['Cliente e valor', 'Como paga', 'Datas e confirmar']
const ATALHOS_PCT = [20, 30, 50, 80, 100]
const ATALHOS_JURO = [5, 8, 10, 12, 15]
const FREQS: PeriodicidadeApi[] = ['MENSAL', 'QUINZENAL', 'SEMANAL', 'DIARIA']

const passo = ref(1)
const f = reactive({ capital: 0, data: '', indicadorId: 0, observacoes: '', tipo: 'PARCELADO' as 'PARCELADO' | 'JUROS', freq: 'MENSAL' as PeriodicidadeApi, n: 6, taxa: 30, primeira: '' })
const primeiraEditada = ref(false)
const cliente = ref<ClienteApi | null>(null)
const busca = ref('')
const clientes = ref<ClienteApi[]>([])
const indicadores = ref<{ id: number; nome: string }[]>([])
const erro = ref('')
const enviando = ref(false)
/** o que a pessoa está digitando nos campos de total/parcela: enquanto bate com a conta, não é reescrito */
const digitado = reactive<{ total: number | null; parcela: number | null }>({ total: null, parcela: null })

watch(() => props.aberto, async (a) => {
  if (!a) return
  Object.assign(f, { capital: 0, data: hoje.value, indicadorId: 0, observacoes: '', tipo: 'PARCELADO', freq: 'MENSAL', n: 6, taxa: 30, primeira: primeiroVenc(hoje.value, 'MENSAL') })
  primeiraEditada.value = false; digitado.total = null; digitado.parcela = null
  cliente.value = null; busca.value = ''; erro.value = ''; passo.value = 1
  indicadores.value = await indicadoresApi.opcoes(sessao.value).catch(() => [])
  await buscar()
})
let espera: ReturnType<typeof setTimeout> | undefined
watch(busca, () => { clearTimeout(espera); espera = setTimeout(buscar, 300) })
async function buscar() {
  const r = await clientesApi.listar(sessao.value, { busca: busca.value.trim() || undefined, limite: 8 }).catch(() => null)
  if (r) clientes.value = r.itens
}

const diaria = computed(() => f.freq === 'DIARIA')
const modalidade = computed<ModalidadeApi>(() => (diaria.value ? 'DIARIA' : f.tipo))
const soJuros = computed(() => modalidade.value === 'JUROS')

// mudou a frequência: a diária é sempre parcelada, os atalhos de quantidade mudam e o 1º vencimento sugerido acompanha
function escolherFreq(x: PeriodicidadeApi) {
  f.freq = x
  if (x === 'DIARIA') f.tipo = 'PARCELADO'
  f.n = FREQ[x].qtd[Math.min(2, FREQ[x].qtd.length - 1)]
  if (soJuros.value && f.taxa > 100) f.taxa = 10
  digitado.total = null; digitado.parcela = null
}
function escolherTipo(t: 'PARCELADO' | 'JUROS') {
  f.tipo = t
  f.taxa = t === 'JUROS' ? 10 : 30
  digitado.total = null; digitado.parcela = null
}
watch([() => f.data, () => f.freq], () => { if (!primeiraEditada.value && f.data) f.primeira = primeiroVenc(f.data, f.freq) })

const plano = computed(() => {
  if (!(f.capital > 0) || !(f.taxa > 0) || !Number.isInteger(f.n) || f.n < 1 || f.n > 120) return []
  return planoEmprestimo({ capital: f.capital, mod: modalidade.value, taxa: f.taxa, n: f.n, data: f.data || hoje.value, freq: f.freq, primeira: f.primeira || undefined })
})
const totalPlano = computed(() => arred2(plano.value.reduce((s, p) => s + p.valor, 0)))
const parcelaPlano = computed(() => plano.value[0]?.valor ?? 0)
const lucro = computed(() => arred2(totalPlano.value - f.capital))

// "Total que ele paga" e "Valor da parcela" (no só juros, "Juro de cada parcela"): mexeu em um, o % e o outro se ajustam
const perto = (a: number, b: number) => Math.abs(a - b) <= 0.011
const totalCampo = computed({
  get: () => (digitado.total !== null && perto(digitado.total, totalPlano.value) ? digitado.total : totalPlano.value),
  set: (v: number) => { digitado.total = v; digitado.parcela = null; if (f.capital > 0 && v > 0) f.taxa = Math.min(999, Math.max(0.01, pctDoTotal(f.capital, v))) },
})
const parcelaCampo = computed({
  get: () => (digitado.parcela !== null && perto(digitado.parcela, parcelaPlano.value) ? digitado.parcela : parcelaPlano.value),
  set: (v: number) => {
    digitado.parcela = v; digitado.total = null
    if (!(f.capital > 0) || !(v > 0)) return
    f.taxa = soJuros.value ? Math.min(100, Math.max(0.01, pctDoJuro(f.capital, v))) : Math.min(999, Math.max(0.01, pctDaParcela(f.capital, v, f.n)))
  },
})
function definirTaxa(v: number) { f.taxa = v; digitado.total = null; digitado.parcela = null }
function definirN(v: number) { f.n = v; digitado.total = null; digitado.parcela = null }

const dia = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '')
const taxaMax = computed(() => (soJuros.value ? 100 : 999))

const problemaPasso = (p: number): string => {
  if (p >= 1) {
    if (!cliente.value) return 'Escolha o cliente.'
    if (!(f.capital > 0)) return 'Informe quanto vai emprestar.'
    if (!f.data || f.data > hoje.value) return 'A data do empréstimo não pode ser no futuro.'
  }
  if (p >= 2) {
    if (!(f.taxa > 0 && f.taxa <= taxaMax.value)) return `Os juros precisam ficar entre 0 e ${taxaMax.value}%.`
    if (!Number.isInteger(f.n) || f.n < 1 || f.n > 120) return 'Parcelas: de 1 a 120.'
  }
  if (p >= 3) {
    if (!f.primeira || f.primeira < f.data) return 'O 1º vencimento não pode ser antes do empréstimo.'
    if (f.primeira > addDia(f.data, 366)) return 'O 1º vencimento não pode passar de um ano depois do empréstimo.'
  }
  return ''
}
const problema = computed(() => problemaPasso(passo.value))
function avancar() { if (!problema.value && passo.value < 3) passo.value += 1 }
const irPara = (p: number) => { if (p <= passo.value || !problemaPasso(p - 1)) passo.value = p }

async function salvar() {
  if (enviando.value || problemaPasso(3) || !cliente.value) return
  enviando.value = true; erro.value = ''
  try {
    emit('salvo', await emprestimosApi.criar(sessao.value, {
      clienteId: cliente.value.id, modalidade: modalidade.value, periodicidade: f.freq, capital: f.capital, taxa: f.taxa, parcelas: f.n,
      dataEmprestimo: f.data, primeiroVencimento: f.primeira,
      ...(f.indicadorId ? { indicadorId: f.indicadorId } : {}), ...(f.observacoes.trim() ? { observacoes: f.observacoes.trim() } : {}),
    }))
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <Sheet :aberto="aberto" @fechar="emit('fechar')">
    <h3>Novo empréstimo</h3>
    <div class="steps" role="tablist" style="margin-top: 10px">
      <button v-for="(l, i) in PASSOS" :key="l" role="tab" type="button" :class="{ on: passo === i + 1, done: passo > i + 1 }" :aria-selected="passo === i + 1" :data-passo="i + 1" @click="irPara(i + 1)"><i></i>{{ i + 1 }}. {{ l }}</button>
    </div>

    <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 12px" novalidate @submit.prevent="passo < 3 ? avancar() : salvar()">
      <!-- 1. cliente e valor -->
      <template v-if="passo === 1">
        <div class="field">
          <label>Cliente</label>
          <div v-if="cliente" class="card pad row" style="gap: 10px" data-testid="cliente-escolhido"><span class="val" style="flex: 1">{{ cliente.nome }}</span><button type="button" class="btn b-ghost b-sm" @click="cliente = null">Trocar</button></div>
          <template v-else>
            <label class="busca"><Icon name="search" small /><input v-model="busca" placeholder="Nome, telefone ou CPF" aria-label="Buscar cliente" /></label>
            <div class="list">
              <button v-for="c in clientes" :key="c.id" type="button" class="li" :data-cliente="c.id" @click="cliente = c"><div class="mid"><div class="t">{{ c.nome }}</div><div class="s">{{ c.fone }}</div></div></button>
              <div v-if="!clientes.length" class="empty">Ninguém encontrado.</div>
            </div>
          </template>
        </div>
        <div class="field"><label for="eCapital">Quanto vai emprestar?</label><MoneyInput id="eCapital" v-model="f.capital" /></div>
        <div class="field"><label for="eData">Data do empréstimo</label><DateField id="eData" v-model="f.data" :max="hoje" min="2020-01-01" /></div>
        <div class="field"><label for="eInd">Indicador (opcional)</label>
          <div class="inp"><select id="eInd" v-model.number="f.indicadorId"><option :value="0">Sem indicador</option><option v-for="i in indicadores" :key="i.id" :value="i.id">{{ i.nome }}</option></select></div>
        </div>
        <div class="field"><label for="eObs">Observações (opcional)</label><div class="inp"><input id="eObs" v-model="f.observacoes" maxlength="500" /></div></div>
      </template>

      <!-- 2. como paga -->
      <template v-else-if="passo === 2">
        <div class="field"><label>De quanto em quanto tempo?</label>
          <div class="pills"><button v-for="x in FREQS" :key="x" type="button" class="pill" :class="{ on: f.freq === x }" :data-freq="x" @click="escolherFreq(x)">{{ FREQ[x].label }}</button></div>
          <div class="small">{{ FREQ[f.freq].cada.charAt(0).toUpperCase() + FREQ[f.freq].cada.slice(1) }}.</div>
        </div>
        <div v-if="!diaria" class="field"><label>Como o cliente paga?</label>
          <div class="pills">
            <button type="button" class="pill" :class="{ on: f.tipo === 'PARCELADO' }" data-mod="PARCELADO" @click="escolherTipo('PARCELADO')">Parcelado</button>
            <button type="button" class="pill" :class="{ on: f.tipo === 'JUROS' }" data-mod="JUROS" @click="escolherTipo('JUROS')">Só juros</button>
          </div>
          <div class="small">{{ soJuros ? 'Paga o juro a cada parcela e o capital vem junto na última.' : 'O capital e os juros são divididos em parcelas iguais.' }}</div>
        </div>
        <div v-else class="small" data-testid="diaria-info">A diária é sempre parcelada: o capital e os juros divididos em parcelas, todo dia menos domingo.</div>

        <div class="field"><label for="eParcelas">Quantas parcelas?</label>
          <div class="pills"><button v-for="q in FREQ[f.freq].qtd" :key="q" type="button" class="pill" :class="{ on: f.n === q }" @click="definirN(q)">{{ q }}x</button></div>
          <div class="inp"><input id="eParcelas" :value="f.n" type="number" min="1" max="120" step="1" inputmode="numeric" @input="definirN(Number(($event.target as HTMLInputElement).value))" /></div>
        </div>

        <div class="field"><label for="eTaxa">{{ soJuros ? `Juros ${FREQ[f.freq].por} (%)` : 'Juros no total (%)' }}</label>
          <div class="pills"><button v-for="x in (soJuros ? ATALHOS_JURO : ATALHOS_PCT)" :key="x" type="button" class="pill" :class="{ on: f.taxa === x }" @click="definirTaxa(x)">{{ x }}%</button></div>
          <div class="inp"><input id="eTaxa" :value="f.taxa" type="number" min="0.01" :max="taxaMax" step="0.01" inputmode="decimal" @input="definirTaxa(Number(($event.target as HTMLInputElement).value))" /></div>
          <div v-if="!soJuros" class="small">100% = o cliente paga o dobro. Pode passar de 100%.</div>
        </div>

        <div class="row" style="gap: 12px">
          <div v-if="!soJuros" class="field" style="flex: 1"><label for="eTotal">Total que ele paga</label><MoneyInput id="eTotal" v-model="totalCampo" /></div>
          <div class="field" style="flex: 1"><label for="eParcela">{{ soJuros ? 'Juro de cada parcela' : 'Valor da parcela' }}</label><MoneyInput id="eParcela" v-model="parcelaCampo" /></div>
        </div>

        <div v-if="plano.length" class="card sim pad" data-testid="previa-emprestimo" style="display: flex; flex-direction: column; gap: 6px">
          <div class="tot"><span>{{ soJuros ? 'Juro de cada parcela' : 'Parcela' }}</span><span class="num" data-testid="previa-parcela">{{ fmt(parcelaPlano) }}</span></div>
          <div v-if="soJuros" class="tot"><span>Última parcela (com o capital)</span><span class="num" data-testid="previa-ultima">{{ fmt(plano[plano.length - 1].valor) }}</span></div>
          <div class="tot"><span>O cliente paga</span><span class="num" data-testid="previa-total">{{ fmt(totalPlano) }}</span></div>
          <div class="tot"><span>Seu lucro bruto</span><span class="num" style="color: var(--ok)">{{ fmt(lucro) }}</span></div>
        </div>
      </template>

      <!-- 3. datas e confirmar -->
      <template v-else>
        <div class="field"><label for="ePrimeira">1º vencimento</label>
          <DateField id="ePrimeira" v-model="f.primeira" :min="f.data" @update:model-value="primeiraEditada = true" />
          <div class="small">{{ diaria ? 'Se cair no domingo, vai para a segunda.' : `Sugerido: ${dmy(primeiroVenc(f.data, f.freq))}.` }}</div>
        </div>
        <div v-if="plano.length" class="card list" data-testid="lista-parcelas" style="max-height: 260px; overflow: auto">
          <div v-for="(p, i) in plano" :key="i" class="li" style="cursor: default" :data-parcela-prevista="i + 1">
            <div class="mid"><div class="t">{{ i + 1 }}ª · {{ dmy(p.venc) }}</div><div class="s">{{ dia(p.venc) }}</div></div>
            <b class="num">{{ fmt(p.valor) }}</b>
          </div>
        </div>
        <div v-if="plano.length" class="card sim pad" data-testid="resumo-emprestimo" style="display: flex; flex-direction: column; gap: 6px">
          <div class="tot"><span>{{ cliente?.nome }}</span><span class="num">{{ fmt(f.capital) }}</span></div>
          <div class="tot"><span>O cliente paga</span><span class="num" data-testid="previa-total">{{ fmt(totalPlano) }}</span></div>
          <div class="tot"><span>Seu lucro bruto</span><span class="num" style="color: var(--ok)">{{ fmt(lucro) }}</span></div>
        </div>
      </template>

      <div v-if="problema" class="small" role="status" style="color: var(--soft)" data-testid="problema-passo">{{ problema }}</div>
      <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
      <div class="row" style="gap: 8px">
        <button v-if="passo > 1" type="button" class="btn b-out" style="flex: 1" @click="passo -= 1">Voltar</button>
        <button v-if="passo < 3" class="btn b-pri" style="flex: 1" type="submit" :disabled="!!problema">Continuar</button>
        <button v-else class="btn b-pri" style="flex: 1" type="submit" :disabled="enviando || !!problema">{{ enviando ? 'Salvando…' : 'Fazer empréstimo' }}</button>
      </div>
    </form>
  </Sheet>
</template>
