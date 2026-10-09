<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import { clientesApi, estoqueApi } from '@/api/recursos'
import type { ClienteApi } from '@/api/clientes'
import type { AparelhoApi, EntradaAparelho } from '@/api/estoque'
import { CORES } from '@/data/cores'
import { useApp } from '@/composables/useApp'
import { imeiValido, soDigitos } from '@/domain/documentos'
import MoneyInput from './MoneyInput.vue'
import Sheet from './Sheet.vue'
import DateField from './DateField.vue'

const props = defineProps<{ aberto: boolean; aparelho: AparelhoApi | null }>()
const emit = defineEmits<{ fechar: []; salvo: [a: AparelhoApi] }>()

const { sessao, hoje } = useApp()
const editando = computed(() => props.aparelho !== null)
const GBS = [64, 128, 256, 512, 1024]
const MODELOS = ['iPhone 11', 'iPhone 12', 'iPhone 13', 'iPhone 13 Pro', 'iPhone 14', 'iPhone 14 Pro', 'iPhone 15', 'iPhone 15 Pro', 'iPhone 16', 'iPhone 16 Pro']

const f = reactive({
  modelo: '', gb: 128, cor: '', condicao: 'Seminovo' as 'Novo' | 'Seminovo', bateria: '100', imei: '', custo: 0, extras: 0, preco: 0,
  dataCompra: '', origem: 'COMPRA' as 'COMPRA' | 'TROCA', estado: 'DISPONIVEL' as 'DISPONIVEL' | 'ENCOMENDADO', clienteId: '', observacoes: '',
})
const erros = reactive<Record<string, string>>({})
const erroGeral = ref('')
const enviando = ref(false)
const clientes = ref<ClienteApi[]>([])

watch(() => props.aberto, async (aberto) => {
  if (!aberto) return
  const a = props.aparelho
  Object.assign(f, {
    modelo: a?.modelo ?? '', gb: a?.gb ?? 128, cor: a?.cor ?? '', condicao: a?.condicao ?? 'Seminovo', bateria: String(a?.bateria ?? 100),
    imei: a?.imei ?? '', custo: a?.custo ?? 0, extras: a?.extras ?? 0, preco: a?.preco ?? 0, dataCompra: a?.dataCompra ?? hoje.value,
    origem: a?.origem ?? 'COMPRA', estado: a?.estado === 'ENCOMENDADO' ? 'ENCOMENDADO' : 'DISPONIVEL', clienteId: a?.paraCliente ? String(a.paraCliente.id) : '',
    observacoes: a?.observacoes ?? '',
  })
  Object.keys(erros).forEach((k) => delete erros[k])
  erroGeral.value = ''
  if (!clientes.value.length) clientes.value = (await clientesApi.listar(sessao.value, { limite: 100 }).catch(() => ({ itens: [] as ClienteApi[] }))).itens
}, { immediate: true })

function validar(): boolean {
  Object.keys(erros).forEach((k) => delete erros[k])
  if (f.modelo.trim().length < 2) erros.modelo = 'Informe o modelo'
  if (f.cor.trim().length < 2) erros.cor = 'Informe a cor'
  const b = Number(f.bateria)
  if (!Number.isInteger(b) || b < 0 || b > 100) erros.bateria = 'Entre 0 e 100'
  // o IMEI que já estava cadastrado não é revalidado (dados antigos podem não passar no dígito verificador)
  const mudouImei = soDigitos(f.imei) !== (props.aparelho?.imei ?? '')
  if (f.imei.trim() && mudouImei && !imeiValido(f.imei)) erros.imei = 'IMEI inválido. Confira os 15 dígitos'
  if (!(f.preco > 0)) erros.preco = 'Informe o preço de venda'
  if (!f.dataCompra) erros.dataCompra = 'Informe a data da compra'
  if (f.estado === 'ENCOMENDADO' && !f.clienteId) erros.clienteId = 'Escolha quem encomendou'
  return Object.keys(erros).length === 0
}

async function enviar() {
  if (enviando.value || !validar()) return
  enviando.value = true
  erroGeral.value = ''
  const dados: EntradaAparelho = {
    modelo: f.modelo, gb: f.gb, cor: f.cor, condicao: f.condicao, bateria: Number(f.bateria), imei: f.imei.trim() ? soDigitos(f.imei) : null,
    custo: f.custo, extras: f.extras, preco: f.preco, dataCompra: f.dataCompra, origem: f.origem, estado: f.estado,
    paraClienteId: f.estado === 'ENCOMENDADO' ? Number(f.clienteId) : null, observacoes: f.observacoes.trim() || null,
  }
  try {
    const r = props.aparelho ? await estoqueApi.atualizar(sessao.value, props.aparelho.id, dados) : await estoqueApi.criar(sessao.value, dados)
    emit('salvo', r)
  } catch (e) {
    const msg = e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.'
    if (e instanceof ErroApi && e.codigo === 'IMEI_DUPLICADO') erros.imei = msg
    else erroGeral.value = msg
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <Sheet :aberto="aberto" @fechar="emit('fechar')">
    <h3>{{ editando ? 'Editar aparelho' : 'Novo aparelho' }}</h3>
    <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px" novalidate @submit.prevent="enviar">
      <div class="grid2">
        <div class="field">
          <label for="aModelo">Modelo *</label>
          <div class="inp"><input id="aModelo" v-model="f.modelo" list="modelos" autocomplete="off" /><datalist id="modelos"><option v-for="m in MODELOS" :key="m" :value="m" /></datalist></div>
          <span v-if="erros.modelo" class="erro-campo">{{ erros.modelo }}</span>
        </div>
        <div class="field">
          <label for="aCor">Cor *</label>
          <div class="inp"><input id="aCor" v-model="f.cor" list="cores" autocomplete="off" /><datalist id="cores"><option v-for="c in Object.keys(CORES)" :key="c" :value="c" /></datalist></div>
          <span v-if="erros.cor" class="erro-campo">{{ erros.cor }}</span>
        </div>
      </div>
      <div class="field"><label>Armazenamento</label><div class="pills"><button v-for="g in GBS" :key="g" type="button" class="pill" :class="{ on: f.gb === g }" @click="f.gb = g">{{ g >= 1024 ? '1 TB' : g + ' GB' }}</button></div></div>
      <div class="grid2">
        <div class="field"><label>Condição</label><div class="pills"><button v-for="c in (['Novo', 'Seminovo'] as const)" :key="c" type="button" class="pill" :class="{ on: f.condicao === c }" @click="f.condicao = c">{{ c }}</button></div></div>
        <div class="field">
          <label for="aBat">Bateria (%)</label>
          <div class="inp"><input id="aBat" v-model="f.bateria" inputmode="numeric" /></div>
          <span v-if="erros.bateria" class="erro-campo">{{ erros.bateria }}</span>
        </div>
      </div>
      <div class="field">
        <label for="aImei">IMEI</label>
        <div class="inp"><input id="aImei" v-model="f.imei" inputmode="numeric" maxlength="19" placeholder="15 dígitos (opcional na encomenda)" autocomplete="off" /></div>
        <span v-if="erros.imei" class="erro-campo">{{ erros.imei }}</span>
      </div>
      <div class="grid2">
        <div class="field"><label for="aCusto">Custo</label><MoneyInput id="aCusto" v-model="f.custo" /></div>
        <div class="field"><label for="aExtras">Extras (reparo, película…)</label><MoneyInput id="aExtras" v-model="f.extras" /></div>
      </div>
      <div class="field">
        <label for="aPreco">Preço de venda *</label><MoneyInput id="aPreco" v-model="f.preco" />
        <span v-if="erros.preco" class="erro-campo">{{ erros.preco }}</span>
        <span v-if="f.preco > 0" class="small">Lucro se vender por este preço: <b :style="{ color: f.preco - f.custo - f.extras >= 0 ? 'var(--ok)' : 'var(--bad)' }">{{ (f.preco - f.custo - f.extras).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }}</b></span>
      </div>
      <div class="grid2">
        <div class="field"><label for="aData">Data da compra</label><DateField id="aData" v-model="f.dataCompra" :max="hoje" /><span v-if="erros.dataCompra" class="erro-campo">{{ erros.dataCompra }}</span></div>
        <div class="field"><label>Veio de</label><div class="pills"><button v-for="o in ([['COMPRA', 'Compra'], ['TROCA', 'Troca']] as const)" :key="o[0]" type="button" class="pill" :class="{ on: f.origem === o[0] }" @click="f.origem = o[0]">{{ o[1] }}</button></div></div>
      </div>
      <div class="field">
        <label>Situação</label>
        <div class="pills"><button v-for="o in ([['DISPONIVEL', 'Disponível'], ['ENCOMENDADO', 'Encomendado']] as const)" :key="o[0]" type="button" class="pill" :class="{ on: f.estado === o[0] }" @click="f.estado = o[0]">{{ o[1] }}</button></div>
        <template v-if="f.estado === 'ENCOMENDADO'">
          <div class="inp"><select id="aCliente" v-model="f.clienteId" aria-label="Quem encomendou"><option value="">Quem encomendou…</option><option v-for="c in clientes" :key="c.id" :value="String(c.id)">{{ c.nome }}</option></select></div>
          <span v-if="erros.clienteId" class="erro-campo">{{ erros.clienteId }}</span>
        </template>
      </div>
      <div class="field"><label for="aObs">Observações</label><div class="inp" style="height: auto; padding: 8px 12px"><textarea id="aObs" v-model="f.observacoes" rows="2" maxlength="500" style="border: 0; outline: 0; width: 100%; font: inherit; resize: vertical; background: none"></textarea></div></div>

      <div v-if="erroGeral" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erroGeral }}</div>
      <button class="btn b-pri b-block" type="submit" :disabled="enviando">{{ enviando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Cadastrar aparelho' }}</button>
    </form>
  </Sheet>
</template>

<style scoped>
.erro-campo { font-size: 12px; color: var(--bad); font-weight: 500; }
</style>
