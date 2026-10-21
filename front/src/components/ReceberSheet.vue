<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import { aprovacoesApi, emprestimosApi, recebimentosApi, vendasApi } from '@/api/recursos'
import type { AlvoApi, RegistradoApi } from '@/api/recebimentos'
import type { FormaPagamentoApi, ParcelaVendaApi } from '@/api/vendas'
import { useApp } from '@/composables/useApp'
import { addDia } from '@/domain/datas'
import { nomeEmprestimo } from '@/domain/emprestimo'
import { dmy, dmyA, fmt, iniciais } from '@/domain/format'
import { arred2 } from '@/domain/format'
import { calcularQuitacao, calcularRecebimento, calcularRecebimentoJuros, descreverEfeitos, planoQuitacao, ErroRecebimento, falta, vencPadraoResto, type RestoPagamento } from '@/domain/recebimento'
import Icon from './Icon.vue'
import MoneyInput from './MoneyInput.vue'
import Sheet from './Sheet.vue'
import DateField from './DateField.vue'

const props = defineProps<{
  /** `aviso`: o indicador avisou que o cliente quitou; a loja confirma por aqui (a data e a forma são as do aviso) */
  alvo: { tipo: AlvoApi; operacaoId: number; parcela: number; quitar?: boolean; aviso?: { id: number; data: string; forma: FormaPagamentoApi; valor: number } } | null
}>()
const emit = defineEmits<{ fechar: []; registrado: [r: RegistradoApi] }>()

const { sessao, hoje } = useApp()
const ehAdmin = computed(() => sessao.value.perfil === 'ADMIN')

/** A venda ou o empréstimo que vai receber, visto de um jeito só. */
interface Operacao {
  tipo: AlvoApi
  cliente: { id: number; nome: string }
  descricao: string
  nParcelas: number
  data: string
  parcelas: ParcelaVendaApi[]
  /** só juros (só o admin recebe capital e taxa) */
  juros: { capitalAberto: number; taxa: number } | null
  ehJuros: boolean
}
const venda = ref<Operacao | null>(null)
const carregando = ref(false)
const erro = ref('')
const enviando = ref(false)
const f = reactive({ data: '', valor: 0, forma: 'PIX' as FormaPagamentoApi, resto: 'FICA' as RestoPagamento, novoVenc: '', pedir: false, motivo: '' })

const parcela = computed(() => venda.value?.parcelas.find((p) => p.numero === props.alvo?.parcela) ?? null)
const faltaAlvo = computed(() => (parcela.value ? falta({ valor: parcela.value.valor, pago: parcela.value.pago, desconto: parcela.value.desconto }) : 0))

watch(() => props.alvo, async (a) => {
  venda.value = null; erro.value = ''
  if (!a) return
  carregando.value = true
  try {
    if (a.tipo === 'VENDA') {
      const v = await vendasApi.obter(sessao.value, a.operacaoId)
      venda.value = { tipo: 'VENDA', cliente: v.cliente, descricao: v.aparelho.modelo, nParcelas: v.nParcelas, data: v.dataVenda, parcelas: v.parcelas, juros: null, ehJuros: false }
    } else {
      const e = await emprestimosApi.obter(sessao.value, a.operacaoId)
      venda.value = {
        tipo: 'EMPRESTIMO', cliente: e.cliente, descricao: nomeEmprestimo(e.modalidade, e.periodicidade), nParcelas: e.nParcelas, data: e.dataEmprestimo, parcelas: e.parcelas,
        juros: e.modalidade === 'JUROS' && e.capitalAberto !== undefined && e.taxa !== undefined ? { capitalAberto: e.capitalAberto, taxa: e.taxa } : null, ehJuros: e.modalidade === 'JUROS',
      }
    }
    const p = venda.value.parcelas.find((x) => x.numero === a.parcela)
    f.data = a.aviso?.data ?? hoje.value
    f.valor = p ? falta({ valor: p.valor, pago: p.pago, desconto: p.desconto }) : 0
    quitarEstado.proximo = false; quitarEstado.desconto = 0; quitarLocal.value = false
    f.forma = a.aviso?.forma ?? 'PIX'; f.resto = 'FICA'; f.pedir = false; f.motivo = ''; f.novoVenc = p ? vencPadraoResto(p.vencimento, hoje.value) : ''
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Não consegui abrir a venda.'
  } finally {
    carregando.value = false
  }
}, { immediate: true })

/** Quitação: cobra juro vencido + capital (só juros) ou tudo que falta; o desconto é a diferença do que ele paga. */
const quitarEstado = reactive({ proximo: false, desconto: 0 })
// o administrador pode virar a tela para "quitou tudo" (só empréstimo); quem abriu já como quitação não volta
const quitarLocal = ref(false)
const quitando = computed(() => props.alvo?.quitar === true || quitarLocal.value)
const podeQuitar = computed(() => ehAdmin.value && props.alvo?.tipo === 'EMPRESTIMO' && !props.alvo.quitar && !props.alvo.aviso)
function virarQuitacao(sim: boolean) {
  quitarLocal.value = sim
  quitarEstado.proximo = false; quitarEstado.desconto = 0
  if (!sim) f.valor = faltaAlvo.value
}

const abertasQ = computed(() => (venda.value?.parcelas ?? []).map((p) => ({ id: p.numero, numero: p.numero, vencimento: p.vencimento, vencimentoOriginal: p.vencimentoOriginal, valor: p.valor, desconto: p.desconto, pago: p.pago, quitadaEm: p.quitadaEm })))
const plano = computed(() => (quitando.value && venda.value ? planoQuitacao(abertasQ.value, { data: f.data || hoje.value, cobrarProximo: quitarEstado.proximo, capitalAberto: venda.value.juros?.capitalAberto ?? null }) : null))
// o valor recebido na quitação é o devido menos o desconto
watch([plano, () => quitarEstado.desconto], () => { if (plano.value) f.valor = Math.max(0, arred2(plano.value.cobrado - Math.min(quitarEstado.desconto, plano.value.cobrado))) }, { immediate: true })
const parcial = computed(() => !quitando.value && f.valor > 0 && f.valor < faltaAlvo.value - 0.009)
const pedindo = computed(() => parcial.value && !ehAdmin.value && f.pedir)
const motivoOk = computed(() => !pedindo.value || (f.motivo.trim().length >= 3 && f.motivo.trim().length <= 500))

/** A prévia do que o recebimento vai fazer, com a mesma regra do servidor. */
const previa = computed(() => {
  if (!venda.value || !(f.valor > 0)) return { texto: '', erro: '' }
  try {
    if (quitando.value) {
      const r = calcularQuitacao(abertasQ.value, { valor: f.valor, data: f.data || hoje.value, cobrarProximo: quitarEstado.proximo }, { capitalAberto: venda.value.juros?.capitalAberto ?? null })
      const partes = [r.amortizacao > 0 ? `abate ${fmt(r.amortizacao)} do capital` : '', r.desconto > 0.009 ? `desconto de ${fmt(r.desconto)}` : ''].filter(Boolean)
      return { texto: `Quita o empréstimo${partes.length ? ': ' + partes.join(', ') : ''}.${r.perdoado > 0.009 ? ` O juro que ainda não venceu (${fmt(r.perdoado)}) fica de fora.` : ''}`, erro: '' }
    }
    const ps = venda.value.parcelas.map((p) => ({ id: p.numero, numero: p.numero, vencimento: p.vencimento, vencimentoOriginal: p.vencimentoOriginal, valor: p.valor, desconto: p.desconto, pago: p.pago, quitadaEm: p.quitadaEm }))
    const pedido = { numero: props.alvo!.parcela, valor: f.valor, data: f.data || hoje.value, hoje: hoje.value, resto: parcial.value ? f.resto : undefined, novoVenc: parcial.value && f.resto === 'FICA' ? f.novoVenc : undefined }
    // só juros: o que passa do juro abate o capital e o juro seguinte é recalculado (só o admin vê capital e taxa para a prévia)
    if (venda.value.juros) {
      const r = calcularRecebimentoJuros(ps, pedido, venda.value.juros)
      return { texto: descreverEfeitos(r.efeitos, fmt, dmy), erro: '' }
    }
    if (venda.value.ehJuros && f.valor > faltaAlvo.value + 0.009) return { texto: 'O que passar do juro abate o capital do cliente e o juro das próximas parcelas é recalculado.', erro: '' }
    const r = calcularRecebimento(ps, pedido)
    return { texto: descreverEfeitos(r.efeitos, fmt, dmy), erro: '' }
  } catch (e) {
    return { texto: '', erro: e instanceof ErroRecebimento ? e.message : '' }
  }
})

const opcoesData = computed(() => [{ rotulo: 'Hoje', valor: hoje.value }, { rotulo: 'Ontem', valor: addDia(hoje.value, -1) }])
const opcoesNovaData = computed(() => {
  const p = parcela.value
  const lista = [{ rotulo: `+3 dias`, valor: addDia(hoje.value, 3) }, { rotulo: '+7 dias', valor: addDia(hoje.value, 7) }, { rotulo: '+15 dias', valor: addDia(hoje.value, 15) }]
  return p && p.vencimento > hoje.value ? [{ rotulo: `Manter ${dmy(p.vencimento)}`, valor: p.vencimento }, ...lista] : lista
})

async function confirmar() {
  if (enviando.value || !props.alvo || previa.value.erro || !(f.valor > 0) || !motivoOk.value) return
  enviando.value = true
  erro.value = ''
  try {
    if (props.alvo.aviso) {
      // o aviso do indicador vira a quitação: a loja manda o valor que calculou (desconto incluso)
      const a = await aprovacoesApi.aprovar(sessao.value, props.alvo.aviso.id, { quitar: true, valor: f.valor, cobrarProximo: quitarEstado.proximo })
      if (!a.recibo) throw new ErroApi(500, 'A quitação foi confirmada, mas o recibo não veio.', 'ERRO')
      emit('registrado', { recibo: a.recibo, efeitos: [], quitada: true, pedidoDescontoId: null })
      return
    }
    const r = await recebimentosApi.registrar(sessao.value, props.alvo.tipo, props.alvo.operacaoId, {
      parcela: props.alvo.parcela, valor: f.valor, forma: f.forma, data: f.data || hoje.value,
      ...(quitando.value ? { quitar: true, cobrarProximo: quitarEstado.proximo } : {}),
      ...(parcial.value ? { resto: f.resto, ...(f.resto === 'FICA' ? { novoVencimento: f.novoVenc } : {}) } : {}),
      ...(pedindo.value ? { pedirDesconto: { motivo: f.motivo.trim() } } : {}),
    })
    emit('registrado', r)
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <Sheet :aberto="alvo !== null" @fechar="emit('fechar')">
    <h3>{{ quitando ? 'Quitar empréstimo' : 'Registrar recebimento' }}</h3>
    <div v-if="carregando" class="empty">Carregando…</div>
    <div v-else-if="!venda || !parcela" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); margin-top: 12px">{{ erro || 'Parcela não encontrada.' }}</div>
    <template v-else>
      <div class="card pad" style="margin-top: 12px; display: flex; gap: 12px; align-items: center; background: var(--elevated)">
        <span class="ini">{{ iniciais(venda.cliente.nome) }}</span>
        <div style="flex: 1; min-width: 0"><div class="val">{{ venda.cliente.nome }}</div><div class="small">{{ venda.descricao }} · parcela {{ parcela.numero }}/{{ venda.nParcelas }} · venc. {{ dmy(parcela.vencimento) }}<template v-if="parcela.vencimentoOriginal"> (era {{ dmy(parcela.vencimentoOriginal) }})</template></div></div>
        <div style="text-align: right"><div class="val num">{{ fmt(faltaAlvo) }}</div><div v-if="parcela.pago > 0" class="small">já pagou {{ fmt(parcela.pago) }}</div></div>
      </div>

      <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px" novalidate @submit.prevent="confirmar">
        <div v-if="alvo?.aviso" class="aviso" data-testid="quitar-aviso">O indicador avisou que o cliente quitou tudo e recebeu {{ fmt(alvo.aviso.valor) }} ({{ dmy(alvo.aviso.data) }}). Confira o valor abaixo.</div>
        <div v-if="ehAdmin && !alvo?.aviso" class="field">
          <label>Quando recebeu?</label>
          <div class="pills">
            <button v-for="o in opcoesData" :key="o.valor" type="button" class="pill" :class="{ on: f.data === o.valor }" @click="f.data = o.valor">{{ o.rotulo }}</button>
            <DateField id="rData" v-model="f.data" :min="venda.data" :max="hoje" rotulo="Data do recebimento" style="height: 36px; flex: 1; min-width: 150px" />
          </div>
        </div>
        <div v-if="quitando && plano" class="card pad" data-testid="quitar-resumo" style="background: var(--elevated)">
          <div v-if="venda.juros" class="between small"><span>Capital em aberto</span><b class="num" data-testid="quitar-capital">{{ fmt(plano.capital) }}</b></div>
          <div class="between small" style="margin-top: 4px"><span>{{ venda.juros ? 'Juros vencidos' : 'Parcelas em aberto' }}</span><b class="num" data-testid="quitar-juros">{{ fmt(plano.cobrado - plano.capital) }}</b></div>
          <div class="between small" style="margin-top: 4px; border-top: 1px solid var(--line); padding-top: 4px"><span>Valor cheio da quitação</span><b class="num" data-testid="quitar-cheio">{{ fmt(plano.cobrado) }}</b></div>
          <label v-if="plano.proxima" class="between small" style="margin-top: 8px; gap: 8px; align-items: center"><span>Cobrar também o juro de {{ dmy(plano.proxima.vencimento) }} ({{ fmt(plano.proxima.valor) }}), que ainda não venceu</span><input v-model="quitarEstado.proximo" type="checkbox" data-quitar-proximo /></label>
          <div v-if="plano.perdoado > 0.009" class="small" style="margin-top: 6px" data-testid="quitar-perdoado">Fica de fora, sem cobrar: {{ fmt(plano.perdoado) }} de juro que ainda não venceu.</div>
        </div>
        <div v-if="quitando && plano" class="field">
          <label for="rDesc">Desconto na quitação</label>
          <MoneyInput id="rDesc" v-model="quitarEstado.desconto" />
          <div class="small">O desconto sai do seu lucro. Deixe R$ 0,00 para cobrar o valor cheio.</div>
        </div>
        <button v-if="quitarLocal" type="button" class="btn b-ghost b-sm" data-so-parcela @click="virarQuitacao(false)">Não, só esta parcela</button>
        <div v-if="quitando && plano" class="between" style="font-weight: 600"><span>Cliente paga agora</span><span class="num" data-testid="quitar-receber">{{ fmt(f.valor) }}</span></div>
        <div v-if="!quitando" class="field">
          <label for="rValor">Quanto recebeu?</label>
          <MoneyInput id="rValor" v-model="f.valor" />
          <div class="pills"><button type="button" class="pill" @click="f.valor = faltaAlvo">Valor cheio</button><button type="button" class="pill" @click="f.valor = Math.round(faltaAlvo * 50) / 100">Metade</button><button v-if="podeQuitar" type="button" class="pill" data-quitou-tudo @click="virarQuitacao(true)"><Icon name="check" small />Quitou tudo</button></div>
        </div>
        <div v-if="!alvo?.aviso" class="field"><label>Como pagou?</label><div class="pills"><button v-for="o in ([['PIX', 'Pix'], ['DINHEIRO', 'Dinheiro'], ['CARTAO', 'Cartão']] as const)" :key="o[0]" type="button" class="pill" :class="{ on: f.forma === o[0] }" @click="f.forma = o[0]">{{ o[1] }}</button></div></div>

        <!-- pagou menos: o que fazer com o resto -->
        <div v-if="parcial" class="field" data-testid="resto">
          <div class="lbl">Faltaram {{ fmt(faltaAlvo - f.valor) }}. O que fazer?</div>
          <button type="button" class="opt" :class="{ on: f.resto === 'FICA' }" data-resto="FICA" @click="f.resto = 'FICA'"><span class="radio"></span><span><span class="val" style="display: block">Fica devendo nesta parcela</span><span class="small">A {{ parcela.numero }}ª continua aberta com {{ fmt(faltaAlvo - f.valor) }}</span></span></button>
          <div v-if="f.resto === 'FICA'" class="field" style="padding: 2px 4px 4px 34px">
            <label>Quando ele paga o que falta?</label>
            <div class="pills">
              <button v-for="o in opcoesNovaData" :key="o.valor" type="button" class="pill" :class="{ on: f.novoVenc === o.valor }" @click="f.novoVenc = o.valor">{{ o.rotulo }}</button>
              <DateField id="rNovoVenc" v-model="f.novoVenc" :min="hoje" rotulo="Nova data do restante" style="height: 36px; flex: 1; min-width: 150px" />
            </div>
            <div class="small">{{ f.novoVenc === parcela.vencimento ? 'O vencimento continua o mesmo.' : `A ${parcela.numero}ª passa a vencer ${dmyA(f.novoVenc || hoje)}${parcela.vencimento < hoje ? ' e sai dos atrasados' : ''}.` }}</div>
          </div>
          <button v-if="ehAdmin" type="button" class="opt" :class="{ on: f.resto === 'DESCONTO' }" data-resto="DESCONTO" @click="f.resto = 'DESCONTO'">
            <span class="radio"></span>
            <span><span class="val" style="display: block">Dar desconto de {{ fmt(faltaAlvo - f.valor) }}</span><span class="small">A {{ parcela.numero }}ª fica quitada. O desconto sai do seu lucro</span></span>
          </button>
          <template v-else>
            <button type="button" class="opt" :class="{ on: f.pedir }" data-resto="PEDIR" @click="f.pedir = !f.pedir; f.resto = 'FICA'">
              <span class="radio"></span>
              <span><span class="val" style="display: block">Pedir desconto de {{ fmt(faltaAlvo - f.valor) }} ao administrador</span><span class="small">O pagamento é lançado agora; o resto fica devendo até ele responder</span></span>
            </button>
            <div v-if="f.pedir" class="field" style="padding: 2px 4px 4px 34px">
              <label for="rMotivo">Por que pedir o desconto?</label>
              <div class="inp"><input id="rMotivo" v-model="f.motivo" maxlength="500" placeholder="Ex.: cliente só tinha esse valor" /></div>
            </div>
          </template>
        </div>

        <div v-if="previa.texto" class="chip c-pri" style="white-space: normal; line-height: 1.4; padding: 6px 10px" data-testid="previa">{{ previa.texto }}</div>
        <div v-else-if="previa.erro" class="chip c-bad" style="white-space: normal; line-height: 1.4; padding: 6px 10px" role="alert">{{ previa.erro }}</div>
        <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
        <button class="btn b-ok b-block" type="submit" :disabled="enviando || !!previa.erro || !(f.valor > 0) || !motivoOk">{{ enviando ? 'Registrando…' : quitando ? 'Confirmar quitação' : 'Confirmar recebimento' }}</button>
      </form>
    </template>
  </Sheet>
</template>
