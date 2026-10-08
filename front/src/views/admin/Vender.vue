<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ErroApi, type ClienteApi, type SalvoCliente } from '@/api/clientes'
import { investidoApi, type AparelhoApi } from '@/api/estoque'
import { clientesApi, estoqueApi, indicadoresApi, vendasApi } from '@/api/recursos'
import type { EntradaVenda, FormaPagamentoApi, JurosApi, VendaApi } from '@/api/vendas'
import ClienteForm from '@/components/ClienteForm.vue'
import Icon from '@/components/Icon.vue'
import MiniFone from '@/components/MiniFone.vue'
import MoneyInput from '@/components/MoneyInput.vue'
import { useApp } from '@/composables/useApp'
import { somaMes } from '@/domain/datas'
import { dmy, fmt, fmt0, iniciais } from '@/domain/format'
import { mascaraFone } from '@/domain/documentos'
import { simularVenda } from '@/domain/calc'

const route = useRoute()
const router = useRouter()
const { sessao, hoje } = useApp()

const ehAdmin = computed(() => sessao.value.perfil === 'ADMIN')
const PASSOS = ['Aparelho', 'Cliente', 'Pagamento']

const passo = ref(1)
const juros = ref<JurosApi>({ pct: 10, maxParcelas: 10 })
const aparelhos = ref<AparelhoApi[]>([])
const buscaAparelho = ref('')
const aparelho = ref<AparelhoApi | null>(null)

const clientes = ref<ClienteApi[]>([])
const buscaCliente = ref('')
const cliente = ref<ClienteApi | null>(null)
const novoClienteAberto = ref(false)

const indicadores = ref<{ id: number; nome: string; pct?: number }[]>([])

const f = reactive({
  preco: 0, entrada: 0, forma: 'PIX' as FormaPagamentoApi, temTroca: false, n: 10, dia: 10, indicadorId: '',
  troca: { modelo: '', gb: 128, cor: '', bateria: '80', valor: 0 },
})
const erro = ref('')
const enviando = ref(false)
const venda = ref<VendaApi | null>(null)

// ---------- carga ----------
async function carregarAparelhos() {
  const [d, e] = await Promise.all([
    estoqueApi.listar(sessao.value, { estado: 'DISPONIVEL', limite: 100 }),
    estoqueApi.listar(sessao.value, { estado: 'ENCOMENDADO', limite: 100 }),
  ])
  aparelhos.value = [...d.itens, ...e.itens]
}
let pedidoCli = 0
async function carregarClientes() {
  const meu = ++pedidoCli
  const r = await clientesApi.listar(sessao.value, { busca: buscaCliente.value.trim() || undefined, limite: 30 }).catch(() => null)
  if (r && meu === pedidoCli) clientes.value = r.itens
}
let espera: ReturnType<typeof setTimeout> | undefined
watch(buscaCliente, () => { clearTimeout(espera); espera = setTimeout(carregarClientes, 300) })
onBeforeUnmount(() => clearTimeout(espera))

async function iniciar() {
  venda.value = null; erro.value = ''; passo.value = 1; aparelho.value = null; cliente.value = null; buscaAparelho.value = ''; buscaCliente.value = ''
  Object.assign(f, { preco: 0, entrada: 0, forma: 'PIX', temTroca: false, n: juros.value.maxParcelas, dia: 10, indicadorId: '', troca: { modelo: '', gb: 128, cor: '', bateria: '80', valor: 0 } })
  const q = route.query
  const id = Number(q.bem)
  if (id) {
    const ap = aparelhos.value.find((a) => a.id === id) ?? (await estoqueApi.obter(sessao.value, id).catch(() => null))
    if (ap && ap.estado !== 'VENDIDO') await escolherAparelho(ap, q)
  }
}

onMounted(async () => {
  const [j, i] = await Promise.all([
    vendasApi.juros(sessao.value).catch(() => juros.value),
    (ehAdmin.value ? indicadoresApi.listar(sessao.value).then((l) => l.filter((x) => x.ativo).map((x) => ({ id: x.id, nome: x.nome, pct: x.pct }))) : indicadoresApi.opcoes(sessao.value)).catch(() => []),
    carregarAparelhos().catch(() => undefined),
    carregarClientes(),
  ])
  juros.value = j; indicadores.value = i
  await iniciar()
})
// "Nova venda" de novo, ou chegar de outra tela com o aparelho preenchido
watch(() => route.fullPath, () => { if (route.path === '/vender') iniciar() })

// ---------- passo 1: aparelho ----------
const aparelhosFiltrados = computed(() => {
  const q = buscaAparelho.value.trim().toLowerCase()
  return aparelhos.value.filter((a) => !q || `${a.modelo} ${a.gb} gb ${a.cor} ${a.imei ?? ''}`.toLowerCase().includes(q))
})

async function escolherAparelho(a: AparelhoApi, q: Record<string, unknown> = {}) {
  aparelho.value = a
  const num = (v: unknown) => (typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined)
  f.preco = num(q.preco) ?? a.preco
  f.entrada = num(q.entrada) ?? Math.round((a.preco * 0.15) / 50) * 50
  f.n = Math.min(num(q.n) ?? juros.value.maxParcelas, juros.value.maxParcelas)
  // encomendado: o cliente já é conhecido
  if (a.estado === 'ENCOMENDADO' && a.paraCliente) cliente.value = (await clientesApi.obter(sessao.value, a.paraCliente.id).catch(() => null)) ?? null
  passo.value = cliente.value ? 3 : 2
}

// ---------- passo 2: cliente ----------
function escolherCliente(c: ClienteApi) { cliente.value = c; passo.value = 3 }
function aoCriarCliente(r: SalvoCliente) { novoClienteAberto.value = false; escolherCliente(r.cliente) }

// ---------- passo 3: pagamento e resumo ----------
const trocaValor = computed(() => (f.temTroca ? f.troca.valor : 0))
const parcelado = computed(() => Math.max(0, Math.round((f.preco - f.entrada - trocaValor.value) * 100) / 100))
const nEfetivo = computed(() => (parcelado.value > 0 ? f.n : 0))
const investido = computed(() => (aparelho.value && aparelho.value.custo !== undefined ? investidoApi(aparelho.value) : 0))
const indicadorSel = computed(() => indicadores.value.find((i) => String(i.id) === f.indicadorId) ?? null)
const sim = computed(() => simularVenda({ preco: f.preco, entrada: f.entrada, troca: trocaValor.value, n: nEfetivo.value, investido: investido.value, pctIndicador: indicadorSel.value?.pct ?? 0, juros: juros.value }))
const primeiroVenc = computed(() => somaMes(hoje.value, 1, f.dia))
const abaixoDaTabela = computed(() => !ehAdmin.value && aparelho.value !== null && f.preco > 0 && f.preco < aparelho.value.preco)
const nOpcoes = computed(() => Array.from({ length: juros.value.maxParcelas }, (_, i) => i + 1))

const problema = computed(() => {
  if (!aparelho.value || !cliente.value) return 'Escolha o aparelho e o cliente.'
  if (!(f.preco > 0)) return 'Informe o preço de venda.'
  if (abaixoDaTabela.value) return `O preço está abaixo da tabela (${fmt0(aparelho.value.preco)}). Só o administrador vende abaixo da tabela.`
  if (f.entrada + trocaValor.value > f.preco + 0.001) return 'A entrada mais a troca passam do preço.'
  if (f.temTroca && (f.troca.modelo.trim().length < 2 || f.troca.cor.trim().length < 2 || !(f.troca.valor > 0) || !(Number(f.troca.bateria) >= 0 && Number(f.troca.bateria) <= 100))) return 'Preencha o aparelho da troca (modelo, cor, bateria e valor).'
  return ''
})

async function confirmar() {
  if (enviando.value || problema.value || !aparelho.value || !cliente.value) return
  enviando.value = true
  erro.value = ''
  const e: EntradaVenda = {
    aparelhoId: aparelho.value.id, clienteId: cliente.value.id, preco: f.preco, entrada: f.entrada, parcelas: nEfetivo.value,
    indicadorId: f.indicadorId ? Number(f.indicadorId) : null,
  }
  if (f.entrada > 0) e.formaEntrada = f.forma
  if (nEfetivo.value > 0) e.diaVencimento = f.dia
  if (f.temTroca) e.troca = { modelo: f.troca.modelo, gb: f.troca.gb, cor: f.troca.cor, bateria: Number(f.troca.bateria), valor: f.troca.valor }
  try {
    venda.value = await vendasApi.criar(sessao.value, e)
    passo.value = 4
  } catch (err) {
    erro.value = err instanceof ErroApi ? err.message : 'Algo deu errado. Tente de novo.'
    // o aparelho pode ter sido vendido por outra pessoa neste meio-tempo: atualiza a lista
    if (err instanceof ErroApi && err.status === 409) carregarAparelhos().catch(() => undefined)
  } finally {
    enviando.value = false
  }
}

const verOperacao = () => router.push(ehAdmin.value ? `/operacoes?venda=${venda.value!.id}` : `/vendas?venda=${venda.value!.id}`)
const novaVenda = () => { if (route.fullPath !== '/vender') router.push('/vender'); else iniciar(); carregarAparelhos().catch(() => undefined) }
const irPara = (p: number) => { if (p === 1 || (p === 2 && aparelho.value) || (p === 3 && aparelho.value && cliente.value)) passo.value = p }
</script>

<template>
  <!-- venda feita -->
  <div v-if="passo === 4 && venda" class="card ok-big" data-testid="venda-feita">
    <span class="ring"><Icon name="check" /></span>
    <h2 style="margin: 0; font-size: 20px; color: var(--strong)">Venda feita!</h2>
    <div class="small">{{ venda.cliente.nome }} · {{ venda.aparelho.modelo }} {{ venda.aparelho.gb }} GB</div>
    <div class="val num" style="font-size: 22px">{{ venda.nParcelas ? `${venda.nParcelas}x de ${fmt(venda.valorParcela)}` : 'Pago à vista' }}</div>
    <div v-if="venda.parcelas.length" class="small">A primeira vence em {{ dmy(venda.parcelas[0].vencimento) }}. Total do cliente: {{ fmt(venda.total) }}.</div>
    <div v-if="venda.seuLucro !== undefined" class="small">Seu lucro previsto: <b style="color: var(--ok)">{{ fmt(venda.seuLucro) }}</b></div>
    <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 6px">
      <button class="btn b-pri" @click="verOperacao">Ver a operação</button>
      <button class="btn b-out" @click="novaVenda">Nova venda</button>
    </div>
  </div>

  <template v-else>
    <div class="steps" role="tablist">
      <button v-for="(l, i) in PASSOS" :key="l" role="tab" :class="{ on: passo === i + 1, done: passo > i + 1 }" :aria-selected="passo === i + 1" @click="irPara(i + 1)"><i></i>{{ i + 1 }}. {{ l }}</button>
    </div>

    <div class="vender-grid">
      <div style="display: flex; flex-direction: column; gap: 14px; min-width: 0">
        <!-- 1. aparelho -->
        <template v-if="passo === 1">
          <label class="busca"><Icon name="search" small /><input v-model="buscaAparelho" placeholder="Modelo, cor ou IMEI" aria-label="Buscar aparelho" /></label>
          <div class="fones">
            <button v-for="a in aparelhosFiltrados" :key="a.id" class="card fone" :data-aparelho="a.id" @click="escolherAparelho(a)">
              <MiniFone :cor="a.cor" />
              <span class="info">
                <span class="nome"><span>{{ a.modelo }} · {{ a.gb }} GB</span><span v-if="a.estado === 'ENCOMENDADO'" class="chip c-gold">encomenda</span></span>
                <span class="specs"><span>{{ a.cor }}</span><span>{{ a.condicao }}</span><span>{{ a.bateria }}%</span><span v-if="a.paraCliente">para {{ a.paraCliente.nome }}</span></span>
                <span class="precos"><b class="num" style="color: var(--strong); font-size: 16px">{{ fmt0(a.preco) }}</b></span>
              </span>
            </button>
            <div v-if="!aparelhosFiltrados.length" class="card empty">Nenhum aparelho disponível.</div>
          </div>
        </template>

        <!-- 2. cliente -->
        <template v-else-if="passo === 2">
          <div class="row" style="gap: 8px">
            <label class="busca" style="flex: 1"><Icon name="search" small /><input v-model="buscaCliente" placeholder="Nome, telefone ou CPF" aria-label="Buscar cliente" /></label>
            <button class="btn b-out" @click="novoClienteAberto = true"><Icon name="user-plus" small />Novo</button>
          </div>
          <div class="card list">
            <button v-for="c in clientes" :key="c.id" class="li" :data-cliente="c.id" @click="escolherCliente(c)">
              <span class="ini">{{ iniciais(c.nome) }}</span><span class="mid"><span class="t">{{ c.nome }}</span><span class="s">{{ mascaraFone(c.fone) }}</span></span>
            </button>
            <div v-if="!clientes.length" class="empty">Ninguém encontrado. Cadastre o cliente em "Novo".</div>
          </div>
        </template>

        <!-- 3. pagamento -->
        <template v-else-if="passo === 3 && aparelho && cliente">
          <div class="card pad row" style="gap: 12px">
            <MiniFone :cor="aparelho.cor" />
            <div style="flex: 1; min-width: 0"><div class="val">{{ aparelho.modelo }} · {{ aparelho.gb }} GB</div><div class="small">para {{ cliente.nome }}</div></div>
            <button class="btn b-ghost b-sm" @click="passo = 1">Trocar</button>
          </div>

          <div class="grid2">
            <div class="field"><label for="vPreco">Preço de venda</label><MoneyInput id="vPreco" v-model="f.preco" /><span v-if="abaixoDaTabela" class="erro-campo">Abaixo da tabela ({{ fmt0(aparelho.preco) }})</span></div>
            <div class="field"><label for="vEntrada">Entrada</label><MoneyInput id="vEntrada" v-model="f.entrada" /></div>
          </div>
          <div class="pills"><button v-for="p in [0, 10, 20, 30, 50]" :key="p" class="pill" type="button" @click="f.entrada = Math.round((f.preco * p) / 100 / 50) * 50">{{ p ? `Entrada ${p}%` : 'Sem entrada' }}</button></div>
          <div v-if="f.entrada > 0" class="field"><label>Como pagou a entrada?</label><div class="pills"><button v-for="o in ([['PIX', 'Pix'], ['DINHEIRO', 'Dinheiro'], ['CARTAO', 'Cartão']] as const)" :key="o[0]" type="button" class="pill" :class="{ on: f.forma === o[0] }" @click="f.forma = o[0]">{{ o[1] }}</button></div></div>

          <button type="button" class="toggle" role="switch" :aria-checked="f.temTroca" @click="f.temTroca = !f.temTroca"><span class="sw" :class="{ on: f.temTroca }"></span><span><span class="val" style="display: block">Cliente deu um aparelho na troca</span><span class="small">Entra no estoque, custando o valor aceito.</span></span></button>
          <div v-if="f.temTroca" class="card pad" style="display: flex; flex-direction: column; gap: 12px">
            <div class="grid2">
              <div class="field"><label for="tModelo">Modelo</label><div class="inp"><input id="tModelo" v-model="f.troca.modelo" autocomplete="off" /></div></div>
              <div class="field"><label for="tCor">Cor</label><div class="inp"><input id="tCor" v-model="f.troca.cor" autocomplete="off" /></div></div>
            </div>
            <div class="grid2">
              <div class="field"><label>Armazenamento</label><div class="pills"><button v-for="g in [64, 128, 256, 512]" :key="g" type="button" class="pill" :class="{ on: f.troca.gb === g }" @click="f.troca.gb = g">{{ g }} GB</button></div></div>
              <div class="field"><label for="tBat">Bateria (%)</label><div class="inp"><input id="tBat" v-model="f.troca.bateria" inputmode="numeric" /></div></div>
            </div>
            <div class="field"><label for="tValor">Valor aceito na troca</label><MoneyInput id="tValor" v-model="f.troca.valor" /></div>
          </div>

          <div v-if="parcelado > 0" class="field">
            <label>Em quantas parcelas?</label>
            <div class="pills"><button v-for="n in nOpcoes" :key="n" type="button" class="pill" :class="{ on: f.n === n }" @click="f.n = n">{{ n }}x</button></div>
            <div class="small">{{ juros.pct }}% por parcela, juros simples, sobre {{ fmt(parcelado) }}.</div>
          </div>
          <div v-else class="aviso" style="background: var(--ok-soft); color: var(--ok)">Não sobra nada para parcelar: a venda fecha quitada.</div>

          <div class="grid2">
            <div v-if="parcelado > 0" class="field"><label for="vDia">Dia do vencimento</label><div class="inp"><select id="vDia" v-model.number="f.dia"><option v-for="d in 31" :key="d" :value="d">dia {{ d }}</option></select></div></div>
            <div class="field"><label for="vInd">Indicação</label><div class="inp"><select id="vInd" v-model="f.indicadorId"><option value="">Sem indicador</option><option v-for="i in indicadores" :key="i.id" :value="String(i.id)">{{ i.nome }}</option></select></div></div>
          </div>
        </template>
      </div>

      <!-- resumo -->
      <div v-if="passo === 3 && aparelho && cliente" class="card sim pad" style="display: flex; flex-direction: column; gap: 12px">
        <div>
          <div class="lbl">{{ nEfetivo ? 'Parcelas' : 'Pagamento' }}</div>
          <div class="parc num" data-testid="resumo-parcela">{{ nEfetivo ? `${nEfetivo}x ${fmt(sim.parc)}` : 'À vista' }}</div>
          <div v-if="nEfetivo" class="small">1ª vence em {{ dmy(primeiroVenc) }}</div>
        </div>
        <div class="linhas">
          <div><span>Preço</span><b class="num">{{ fmt(f.preco) }}</b></div>
          <div v-if="f.entrada"><span>− Entrada</span><span class="num">{{ fmt(f.entrada) }}</span></div>
          <div v-if="trocaValor"><span>− Troca</span><span class="num">{{ fmt(trocaValor) }}</span></div>
          <div><span>Fica pra parcelar</span><span class="num" data-testid="resumo-parcelado">{{ fmt(sim.parcelado) }}</span></div>
          <div v-if="nEfetivo"><span>Juros ({{ juros.pct }}% × {{ nEfetivo }})</span><span class="num">{{ fmt(sim.jurosTotal) }}</span></div>
          <div class="tot"><span>O cliente paga</span><span class="num" data-testid="resumo-total">{{ fmt(sim.total) }}</span></div>
          <template v-if="aparelho.custo !== undefined">
            <div><span>Custo do aparelho</span><span class="num">{{ fmt(investido) }}</span></div>
            <div v-if="indicadorSel"><span>Parte do indicador ({{ Math.round((indicadorSel.pct ?? 0) * 100) }}%)</span><span class="num">{{ fmt(sim.parteIndicador) }}</span></div>
            <div class="tot"><span>Seu lucro</span><span class="num" :style="{ color: sim.seuLucro >= 0 ? 'var(--ok)' : 'var(--bad)' }" data-testid="resumo-lucro">{{ fmt(sim.seuLucro) }}</span></div>
            <div class="small">{{ sim.volta === 0 ? 'Seu capital volta já na entrada.' : sim.volta ? `Seu capital volta na parcela ${sim.volta}.` : 'O capital não volta só com o combinado.' }}</div>
          </template>
        </div>
        <div v-if="problema" class="aviso" role="alert">{{ problema }}</div>
        <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
        <button class="btn b-pri b-block" :disabled="!!problema || enviando" @click="confirmar">{{ enviando ? 'Registrando…' : 'Confirmar venda' }}</button>
      </div>
    </div>
  </template>

  <ClienteForm :aberto="novoClienteAberto" :cliente="null" @fechar="novoClienteAberto = false" @salvo="aoCriarCliente" />
</template>

<style scoped>
.erro-campo { font-size: 12px; color: var(--bad); font-weight: 500; }
</style>
