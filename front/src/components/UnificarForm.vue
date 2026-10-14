<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { EmprestimoApi } from '@/api/emprestimos'
import { acordosApi } from '@/api/recursos'
import { useApp } from '@/composables/useApp'
import { useToast } from '@/composables/useToast'
import { distribuirAcordo, indicadoresDiferentes, PERIODICIDADES_ACORDO, problemaDoAcordo, resumoUnificacao, valorSugeridoAcordo, vencimentosAcordo, type PeriodicidadeAcordo } from '@/domain/acordo'
import { addDia } from '@/domain/datas'
import { arred2, dmy, fmt } from '@/domain/format'
import { nomeEmprestimo } from '@/domain/emprestimo'
import DateField from './DateField.vue'
import MoneyInput from './MoneyInput.vue'
import Sheet from './Sheet.vue'

/**
 * Unificar empréstimos: junta o que o cliente ainda deve em vários empréstimos num empréstimo NOVO, com um acordo só.
 * O aberto de cada um fica "encerrado por acordo"; o capital que ainda estava na rua passa para o novo. Só o administrador.
 */
const props = defineProps<{ aberto: boolean; selecionados: number[]; candidatos: EmprestimoApi[] }>()
const emit = defineEmits<{ fechar: []; feito: [novoId: number] }>()
const { sessao, hoje } = useApp()
const { mostrar } = useToast()

const ATALHOS = [1, 2, 3, 4, 6, 10, 12]
const marcados = ref<number[]>([])
const f = reactive({ valor: 0, n: 3, primeira: '', motivo: '', novo: 0, jurosNovo: 0, periodicidade: 'MENSAL' as PeriodicidadeAcordo, indicador: undefined as number | null | undefined })
const erro = ref('')
const enviando = ref(false)

/** do mesmo cliente do primeiro escolhido, em andamento, e com algo em aberto */
const elegiveis = computed(() => {
  const base = props.candidatos.find((e) => e.id === props.selecionados[0])
  if (!base) return []
  return props.candidatos.filter((e) => e.cliente.id === base.cliente.id && e.status === 'ATIVA' && e.falta > 0.009)
})
const escolhidos = computed(() => elegiveis.value.filter((e) => marcados.value.includes(e.id)))
const conta = computed(() => resumoUnificacao(escolhidos.value))
const novo = computed(() => arred2(f.novo))
const jurosNovo = computed(() => (novo.value > 0 ? arred2(f.jurosNovo) : 0))
const sugerido = computed(() => valorSugeridoAcordo(conta.value.saldo, novo.value, jurosNovo.value))
const capitalNovo = computed(() => arred2(conta.value.capitalNaRua + novo.value))
const diferenca = computed(() => arred2(f.valor - sugerido.value))
const pedeIndicador = computed(() => indicadoresDiferentes(escolhidos.value))
const indicadoresEscolhidos = computed(() => [...new Map(escolhidos.value.filter((e) => e.indicador).map((e) => [e.indicador!.id, e.indicador!])).values()])

watch(() => props.aberto, (a) => {
  if (!a) return
  marcados.value = [...props.selecionados]
  Object.assign(f, { valor: 0, n: 3, primeira: addDia(hoje.value, 7), motivo: '', novo: 0, jurosNovo: 0, periodicidade: 'MENSAL', indicador: undefined })
  f.valor = sugerido.value
  erro.value = ''
})
// o valor do acordo acompanha a soma enquanto o administrador não o ajustar à mão
watch(sugerido, (novoValor, antigo) => { if (Math.abs(f.valor - antigo) < 0.01 || f.valor === 0) f.valor = novoValor })
watch(pedeIndicador, (p) => { if (!p) f.indicador = undefined })

function alternar(id: number) {
  marcados.value = marcados.value.includes(id) ? marcados.value.filter((x) => x !== id) : [...marcados.value, id]
}

const valores = computed(() => distribuirAcordo(arred2(f.valor), f.n))
const datas = computed(() => (f.primeira && f.n >= 1 && f.n <= 120 ? vencimentosAcordo(f.primeira, f.n, f.periodicidade) : []))
const dia = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '')
const ajudaPeriodicidade = computed(() => PERIODICIDADES_ACORDO.find((x) => x.valor === f.periodicidade)?.ajuda ?? '')
const problema = computed(() => {
  if (escolhidos.value.length < 2) return 'Marque pelo menos 2 empréstimos do mesmo cliente.'
  if (pedeIndicador.value && f.indicador === undefined) return 'Os empréstimos têm indicadores diferentes: escolha quem fica com o novo.'
  return problemaDoAcordo({ valorTotal: f.valor, parcelas: f.n, primeiraParcela: f.primeira, capitalAdicional: novo.value }, hoje.value)
})

async function confirmar() {
  if (enviando.value || problema.value) return
  enviando.value = true; erro.value = ''
  try {
    const r = await acordosApi.unificar(sessao.value, {
      emprestimoIds: escolhidos.value.map((e) => e.id), valorTotal: arred2(f.valor), parcelas: f.n, primeiraParcela: f.primeira,
      ...(f.periodicidade !== 'MENSAL' ? { periodicidade: f.periodicidade } : {}), ...(novo.value > 0 ? { capitalAdicional: novo.value } : {}),
      ...(f.motivo.trim() ? { motivo: f.motivo.trim() } : {}), ...(pedeIndicador.value ? { indicadorId: f.indicador ?? null } : {}),
    })
    mostrar('Empréstimos unificados.')
    emit('feito', r.emprestimoId)
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <Sheet :aberto="aberto" @fechar="emit('fechar')">
    <template v-if="elegiveis.length">
      <h3>Unificar empréstimos</h3>
      <div class="small">{{ elegiveis[0].cliente.nome }} · junta o que ele deve em vários empréstimos num só</div>

      <div class="lbl" style="margin: 14px 0 6px">Quais empréstimos?</div>
      <div class="card list" data-testid="unificar-lista">
        <label v-for="e in elegiveis" :key="e.id" class="li" style="cursor: pointer" :data-unificar-item="e.id">
          <input type="checkbox" :checked="marcados.includes(e.id)" :aria-label="`Empréstimo ${e.id}`" style="width: 18px; height: 18px; flex: none" @change="alternar(e.id)" />
          <div class="mid">
            <div class="t">#{{ e.id }} · {{ nomeEmprestimo(e.modalidade, e.periodicidade) }}</div>
            <div class="s">{{ dmy(e.dataEmprestimo) }} · capital na rua {{ fmt(Math.max(0, (e.capital ?? 0) - (e.capitalDeVolta ?? 0))) }}<template v-if="e.indicador"> · {{ e.indicador.nome }}</template></div>
          </div>
          <b class="num">{{ fmt(e.falta) }}</b>
        </label>
      </div>
      <div v-if="elegiveis.length < 2" class="small" style="margin-top: 6px">Este cliente não tem outro empréstimo em andamento para juntar.</div>

      <div class="card pad" style="margin-top: 12px; background: var(--elevated)" data-testid="unificar-saldo">
        <div class="lbl">Ele deve nos {{ escolhidos.length }} marcados</div><div class="val num">{{ fmt(conta.saldo) }}</div>
        <div class="small" data-testid="unificar-capital">Capital na rua que passa para o novo: {{ fmt(conta.capitalNaRua) }}</div>
      </div>

      <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px" novalidate @submit.prevent="confirmar">
        <div class="field"><label for="uNovo">Dinheiro novo emprestado (opcional)</label><MoneyInput id="uNovo" v-model="f.novo" />
          <div class="small">Se você mandou mais dinheiro para ele junto. Soma no capital do empréstimo novo e sai do Caixa hoje.</div>
        </div>
        <div v-if="novo > 0" class="field"><label for="uJurosNovo">Juros cobrados sobre o dinheiro novo</label><MoneyInput id="uJurosNovo" v-model="f.jurosNovo" /></div>
        <div class="field"><label for="uValor">Valor do acordo</label><MoneyInput id="uValor" v-model="f.valor" />
          <div v-if="novo > 0" class="small" data-testid="unificar-conta">Ele devia {{ fmt(conta.saldo) }} + dinheiro novo {{ fmt(novo) }} + juros {{ fmt(jurosNovo) }} = {{ fmt(sugerido) }}</div>
          <div v-if="f.valor > 0 && diferenca !== 0" class="small" data-testid="unificar-diferenca">{{ diferenca < 0 ? `Desconto de ${fmt(-diferenca)} sobre a soma` : `Juros do acordo de ${fmt(diferenca)} sobre a soma` }}</div>
          <div class="small" data-testid="unificar-capital-novo">Capital do empréstimo novo: {{ fmt(capitalNovo) }}</div>
        </div>
        <div class="field"><label for="uParcelas">Em quantas parcelas?</label>
          <div class="pills"><button v-for="q in ATALHOS" :key="q" type="button" class="pill" :class="{ on: f.n === q }" @click="f.n = q">{{ q }}x</button></div>
          <div class="inp"><input id="uParcelas" v-model.number="f.n" type="number" min="1" max="120" step="1" inputmode="numeric" /></div>
        </div>
        <div class="field"><label>De quanto em quanto tempo?</label>
          <div class="pills" data-testid="unificar-periodicidade"><button v-for="o in PERIODICIDADES_ACORDO" :key="o.valor" type="button" class="pill" :class="{ on: f.periodicidade === o.valor }" :data-periodicidade="o.valor" @click="f.periodicidade = o.valor">{{ o.rotulo }}</button></div>
        </div>
        <div class="field"><label for="uData">Data da 1ª parcela</label><DateField id="uData" v-model="f.primeira" :min="hoje" /><div class="small">{{ ajudaPeriodicidade }}</div></div>
        <div v-if="pedeIndicador" class="field" data-testid="unificar-indicador"><label>Quem fica com o empréstimo novo?</label>
          <div class="small">Os empréstimos têm indicadores diferentes. O que cada um já tinha a receber não muda.</div>
          <div class="pills">
            <button v-for="i in indicadoresEscolhidos" :key="i.id" type="button" class="pill" :class="{ on: f.indicador === i.id }" :data-indicador="i.id" @click="f.indicador = i.id">{{ i.nome }}</button>
            <button type="button" class="pill" :class="{ on: f.indicador === null }" data-indicador="nenhum" @click="f.indicador = null">Sem indicador</button>
          </div>
        </div>
        <div class="field"><label for="uMotivo">Motivo (opcional)</label><div class="inp"><input id="uMotivo" v-model="f.motivo" maxlength="500" placeholder="Ex.: juntar os dois empréstimos a pedido do cliente" /></div></div>

        <div v-if="valores.length && datas.length" class="card list" data-testid="lista-unificar" style="max-height: 200px; overflow: auto">
          <div v-for="(v, i) in valores" :key="i" class="li" style="cursor: default" :data-parcela-unificar="i + 1">
            <div class="mid"><div class="t">{{ i + 1 }}ª · {{ dmy(datas[i]) }}</div><div class="s">{{ dia(datas[i]) }}</div></div>
            <b class="num">{{ fmt(v) }}</b>
          </div>
        </div>
        <div class="small">Os empréstimos marcados ficam encerrados por este acordo (o que já foi pago continua no histórico de cada um) e nasce um empréstimo novo com as parcelas acima. Não dá para desfazer.</div>

        <div v-if="problema" class="small" role="status" style="color: var(--soft)" data-testid="problema-unificar">{{ problema }}</div>
        <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
        <button class="btn b-pri b-block" type="submit" :disabled="enviando || !!problema">{{ enviando ? 'Salvando…' : 'Unificar empréstimos' }}</button>
      </form>
    </template>
  </Sheet>
</template>
