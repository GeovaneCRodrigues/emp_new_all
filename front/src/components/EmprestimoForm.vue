<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ErroApi, type ClienteApi } from '@/api/clientes'
import { MODALIDADES_LIBERADAS, type EmprestimoApi, type ModalidadeApi } from '@/api/emprestimos'
import { clientesApi, emprestimosApi, indicadoresApi } from '@/api/recursos'
import { useApp } from '@/composables/useApp'
import { planoEmprestimo } from '@/domain/calc'
import { dmy, fmt } from '@/domain/format'
import Icon from './Icon.vue'
import MoneyInput from './MoneyInput.vue'
import Sheet from './Sheet.vue'

const props = defineProps<{ aberto: boolean }>()
const emit = defineEmits<{ fechar: []; salvo: [e: EmprestimoApi] }>()
const { sessao, hoje } = useApp()

const MODS: { id: ModalidadeApi; nome: string }[] = [{ id: 'PARCELADO', nome: 'Parcelado' }, { id: 'JUROS', nome: 'Só juros' }, { id: 'DIARIA', nome: 'Diária' }]
const f = reactive({ modalidade: 'PARCELADO' as ModalidadeApi, capital: 0, taxa: 10, parcelas: 6, indicadorId: 0, observacoes: '' })
const cliente = ref<ClienteApi | null>(null)
const busca = ref('')
const clientes = ref<ClienteApi[]>([])
const indicadores = ref<{ id: number; nome: string }[]>([])
const erro = ref('')
const enviando = ref(false)

watch(() => props.aberto, async (a) => {
  if (!a) return
  Object.assign(f, { modalidade: 'PARCELADO', capital: 0, taxa: 10, parcelas: 6, indicadorId: 0, observacoes: '' })
  cliente.value = null; busca.value = ''; erro.value = ''
  indicadores.value = await indicadoresApi.opcoes(sessao.value).catch(() => [])
  await buscar()
})
let espera: ReturnType<typeof setTimeout> | undefined
watch(busca, () => { clearTimeout(espera); espera = setTimeout(buscar, 300) })
async function buscar() {
  const r = await clientesApi.listar(sessao.value, { busca: busca.value.trim() || undefined, limite: 8 }).catch(() => null)
  if (r) clientes.value = r.itens
}

/** A prévia usa a mesma conta do servidor; o servidor refaz tudo ao gravar. */
const previa = computed(() => {
  if (!(f.capital > 0) || !(f.taxa > 0) || !Number.isInteger(f.parcelas) || f.parcelas < 1 || f.parcelas > 60 || !MODALIDADES_LIBERADAS.includes(f.modalidade)) return null
  const plano = planoEmprestimo({ capital: f.capital, mod: f.modalidade, taxa: f.taxa, n: f.parcelas, data: hoje.value })
  const total = Math.round(plano.reduce((s, p) => s + p.valor, 0) * 100) / 100
  return { parcela: plano[0].valor, ultima: plano[plano.length - 1].valor, total, lucro: Math.round((total - f.capital) * 100) / 100, primeira: plano[0].venc }
})
const problema = computed(() => {
  if (!cliente.value) return 'Escolha o cliente.'
  if (!(f.capital > 0)) return 'Informe quanto vai emprestar.'
  if (!(f.taxa > 0 && f.taxa <= 100)) return 'A taxa precisa ficar entre 0 e 100%.'
  if (!Number.isInteger(f.parcelas) || f.parcelas < 1 || f.parcelas > 60) return 'Parcelas: de 1 a 60.'
  return ''
})

async function salvar() {
  if (enviando.value || problema.value || !cliente.value) return
  enviando.value = true; erro.value = ''
  try {
    emit('salvo', await emprestimosApi.criar(sessao.value, {
      clienteId: cliente.value.id, modalidade: f.modalidade, capital: f.capital, taxa: f.taxa, parcelas: f.parcelas,
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
    <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 12px" novalidate @submit.prevent="salvar">
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

      <div class="field"><label>Modalidade</label>
        <div class="pills"><button v-for="m in MODS" :key="m.id" type="button" class="pill" :class="{ on: f.modalidade === m.id }" :disabled="!MODALIDADES_LIBERADAS.includes(m.id)" :data-mod="m.id" @click="f.modalidade = m.id">{{ m.nome }}<small v-if="!MODALIDADES_LIBERADAS.includes(m.id)"> · em breve</small></button></div>
      </div>

      <div class="field"><label for="eCapital">Quanto vai emprestar?</label><MoneyInput id="eCapital" v-model="f.capital" /></div>
      <div class="row" style="gap: 12px">
        <div class="field" style="flex: 1"><label for="eTaxa">{{ f.modalidade === 'DIARIA' ? 'Taxa (% do período todo)' : 'Taxa (% ao mês)' }}</label><div class="inp"><input id="eTaxa" v-model.number="f.taxa" type="number" min="0.01" max="100" step="0.01" inputmode="decimal" /></div></div>
        <div class="field" style="flex: 1"><label for="eParcelas">{{ f.modalidade === 'DIARIA' ? 'Dias úteis' : 'Parcelas' }}</label><div class="inp"><input id="eParcelas" v-model.number="f.parcelas" type="number" min="1" max="60" step="1" inputmode="numeric" /></div></div>
      </div>
      <div class="field"><label for="eInd">Indicador (opcional)</label>
        <div class="inp"><select id="eInd" v-model.number="f.indicadorId"><option :value="0">Sem indicador</option><option v-for="i in indicadores" :key="i.id" :value="i.id">{{ i.nome }}</option></select></div>
      </div>
      <div class="field"><label for="eObs">Observações (opcional)</label><div class="inp"><input id="eObs" v-model="f.observacoes" maxlength="500" /></div></div>

      <div v-if="previa" class="card sim pad" data-testid="previa-emprestimo" style="display: flex; flex-direction: column; gap: 6px">
        <div class="tot"><span>{{ f.modalidade === 'JUROS' ? 'Juro por mês' : f.modalidade === 'DIARIA' ? 'Parcela por dia' : 'Parcela' }}</span><span class="num" data-testid="previa-parcela">{{ fmt(previa.parcela) }}</span></div>
        <div v-if="f.modalidade === 'JUROS'" class="tot"><span>Última parcela (com o capital)</span><span class="num" data-testid="previa-ultima">{{ fmt(previa.ultima) }}</span></div>
        <div class="tot"><span>O cliente paga</span><span class="num" data-testid="previa-total">{{ fmt(previa.total) }}</span></div>
        <div class="tot"><span>Seu lucro bruto</span><span class="num" style="color: var(--ok)">{{ fmt(previa.lucro) }}</span></div>
        <div class="small">{{ f.modalidade === 'DIARIA' ? 'Cobra de segunda a sábado; a primeira vence' : 'A primeira parcela vence' }} em {{ dmy(previa.primeira) }}.</div>
      </div>
      <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erro }}</div>
      <button class="btn b-pri b-block" type="submit" :disabled="enviando || !!problema" :title="problema">{{ enviando ? 'Salvando…' : 'Fazer empréstimo' }}</button>
    </form>
  </Sheet>
</template>
