<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import MoneyInput from '@/components/MoneyInput.vue'
import Sheet from '@/components/Sheet.vue'
import { useApp } from '@/composables/useApp'
import { estoqueApi } from '@/api/recursos'
import type { AparelhoApi } from '@/api/estoque'
import { investidoApi } from '@/api/estoque'
import { planoParc } from '@/domain/calc'
import { fmt, fmt0 } from '@/domain/format'

const route = useRoute()
const router = useRouter()
const { d, pode, sessao } = useApp()

const juros = computed(() => d.value?.juros ?? { pct: 10, maxParcelas: 10 })
const disponiveis = ref<AparelhoApi[]>([])
onMounted(async () => {
  disponiveis.value = (await estoqueApi.listar(sessao.value, { estado: 'DISPONIVEL', limite: 100 }).catch(() => ({ itens: [] as AparelhoApi[] }))).itens
  // /simulador?bem=ID: o aparelho pode não estar na primeira página
  const id = Number(route.query.bem)
  if (id) { if (!disponiveis.value.some((b) => b.id === id)) { const b = await estoqueApi.obter(sessao.value, id).catch(() => null); if (b && b.estado === 'DISPONIVEL') disponiveis.value.push(b) } escolherBem(id) }
})

const s = reactive({ bemId: null as number | null, preco: 7500, entrada: 0, n: 10 })
const waAberto = ref(false)
const copiado = ref(false)

// abrir pelo aparelho do estoque: /simulador?bem=4
watch(() => route.query.bem, (id) => { if (id) escolherBem(Number(id)) })

function escolherBem(id: number | null) {
  s.bemId = id
  const b = disponiveis.value.find((x) => x.id === id)
  if (b) { s.preco = b.preco; s.entrada = 0 }
}
/** Atalho de entrada: % do preço, arredondado de 50 em 50. */
function entradaPct(p: number) { s.entrada = Math.round((s.preco * p) / 100 / 50) * 50 }

const bem = computed(() => disponiveis.value.find((b) => b.id === s.bemId) ?? null)
const entrada = computed(() => Math.min(s.entrada, s.preco))
const parcelado = computed(() => Math.max(0, s.preco - entrada.value))
const linhas = computed(() =>
  Array.from({ length: juros.value.maxParcelas }, (_, i) => {
    const n = i + 1
    const pl = planoParc(parcelado.value, n, juros.value)
    const totalCli = entrada.value + pl.total
    return { n, ...pl, totalCli, lucro: bem.value && bem.value.custo !== undefined ? totalCli - investidoApi(bem.value) : null }
  }),
)
const sel = computed(() => linhas.value.find((l) => l.n === s.n) ?? linhas.value.at(-1)!)
const dobro = computed(() => juros.value.pct * juros.value.maxParcelas === 100)

const mensagem = computed(() => {
  const nome = bem.value ? `${bem.value.modelo} ${bem.value.gb} GB` : 'iPhone'
  const ns = [...new Set([1, 3, 5, 6, 8, 10].filter((n) => n <= juros.value.maxParcelas).concat(s.n))].sort((a, b) => a - b)
  const corpo = ns.map((n) => { const l = linhas.value[n - 1]; return `${n}x de ${fmt(l.parc)}${n === s.n ? '  ⭐' : ''}` }).join('\n')
  return `*${nome}* · ${fmt(s.preco)}\n${entrada.value ? `Entrada: ${fmt(entrada.value)}\n` : ''}\n${corpo}\n\nQualquer dúvida me chama aqui!`
})
/** Abre a venda já preenchida com o que foi simulado. */
function venderAssim() {
  const q = new URLSearchParams({ preco: String(s.preco), entrada: String(entrada.value), n: String(s.n) })
  if (s.bemId) q.set('bem', String(s.bemId))
  router.push('/vender?' + q.toString())
}
async function copiar() {
  try { await navigator.clipboard.writeText(mensagem.value); copiado.value = true; setTimeout(() => (copiado.value = false), 2000) } catch { /* sem permissão: o texto já está na tela */ }
}
</script>

<template>
  <div class="vender-grid">
    <div style="display: flex; flex-direction: column; gap: 14px">
      <div class="field">
        <label for="simBem">Aparelho</label>
        <div class="inp">
          <select id="simBem" style="font-size: 15px" :value="s.bemId ?? ''" @change="escolherBem(Number(($event.target as HTMLSelectElement).value) || null)">
            <option value="">Digitar o preço</option>
            <option v-for="b in disponiveis" :key="b.id" :value="b.id">{{ b.modelo }} {{ b.gb }} GB {{ b.cor }} · {{ fmt0(b.preco) }}</option>
          </select>
        </div>
      </div>
      <div class="grid2">
        <div class="field"><label for="simPreco">Preço de venda</label><MoneyInput id="simPreco" v-model="s.preco" /></div>
        <div class="field"><label for="simEntrada">Entrada</label><MoneyInput id="simEntrada" v-model="s.entrada" /></div>
      </div>
      <div class="pills">
        <button v-for="p in [0, 10, 20, 30, 50]" :key="p" class="pill" @click="entradaPct(p)">{{ p ? `Entrada ${p}%` : 'Sem entrada' }}</button>
      </div>
      <div class="card pad small">
        Regra: <b style="color: var(--strong)">{{ juros.pct }}% por parcela</b> sobre o que fica depois da entrada, em até {{ juros.maxParcelas }}x.
        Em {{ juros.maxParcelas }}x o cliente paga {{ dobro ? 'o dobro' : `${100 + juros.pct * juros.maxParcelas}%` }} do valor parcelado. Muda em Configurações.
      </div>
    </div>

    <div class="card sim" style="padding: 0">
      <div style="padding: 16px 16px 8px">
        <div class="lbl">Fica pra parcelar</div>
        <div class="disp num" style="font-size: 24px; color: var(--strong)">{{ fmt(parcelado) }}</div>
        <div class="small">{{ fmt(s.preco) }}{{ entrada ? ` − ${fmt(entrada)} de entrada` : ' · sem entrada' }}</div>
      </div>
      <div class="list simtab">
        <button v-for="l in linhas" :key="l.n" class="li" :class="{ on: l.n === s.n }" @click="s.n = l.n">
          <span class="mid">
            <b class="num" style="color: var(--strong); font-size: 15px">{{ l.n }}x {{ fmt(l.parc) }}</b>
            <span class="s" style="display: block">total {{ fmt0(l.totalCli) }} · juros {{ fmt0(l.juros) }}</span>
          </span>
          <span v-if="pode.verCustoELucro && l.lucro !== null" style="text-align: right">
            <span class="lbl" style="display: block">seu lucro</span>
            <b class="num" :style="{ color: l.lucro >= 0 ? 'var(--ok)' : 'var(--bad)' }">{{ fmt0(l.lucro) }}</b>
          </span>
        </button>
      </div>
      <div style="padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 8px">
        <div class="small" style="text-align: center">Escolhido: <b style="color: var(--strong)">{{ entrada ? `${fmt(entrada)} + ` : '' }}{{ sel.n }}x {{ fmt(sel.parc) }}</b></div>
        <div class="row" style="gap: 8px">
          <button class="btn b-out" style="flex: 1" @click="waAberto = true"><Icon name="message-circle" small />Mandar pro cliente</button>
          <button class="btn b-pri" style="flex: 1" @click="venderAssim"><Icon name="plus" small />Vender assim</button>
        </div>
      </div>
    </div>
  </div>

  <Sheet :aberto="waAberto" @fechar="waAberto = false">
    <h3>Mandar simulação</h3>
    <div class="small" style="margin: 2px 0 12px">Copie e mande no WhatsApp do cliente.</div>
    <div class="msg">{{ mensagem }}</div>
    <div style="display: flex; gap: 8px; margin-top: 14px">
      <button class="btn b-ok b-block" @click="copiar"><Icon name="copy" small />{{ copiado ? 'Copiado!' : 'Copiar mensagem' }}</button>
    </div>
  </Sheet>
</template>
