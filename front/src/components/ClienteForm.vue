<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ErroApi, type ClienteApi, type EntradaCliente, type Responsavel, type SalvoCliente } from '@/api/clientes'
import { clientesApi } from '@/api/recursos'
import { useApp } from '@/composables/useApp'
import { cpfValido, mascaraCpf, mascaraFone, normalizarFone } from '@/domain/documentos'
import Sheet from './Sheet.vue'

const props = defineProps<{ aberto: boolean; cliente: ClienteApi | null }>()
const emit = defineEmits<{ fechar: []; salvo: [r: SalvoCliente] }>()

const { sessao, pode } = useApp()
const editando = computed(() => props.cliente !== null)
const ehAdmin = computed(() => sessao.value.perfil === 'ADMIN')
const ehIndicador = computed(() => sessao.value.perfil === 'INDICADOR')

const ORIGENS = ['Instagram', 'WhatsApp', 'Indicação', 'Loja', 'Outro']

const f = reactive({ nome: '', fone: '', cpf: '', rg: '', endereco: '', origem: '', responsavelId: '' as string })
const erros = reactive<Record<string, string>>({})
const erroGeral = ref('')
const enviando = ref(false)
const responsaveis = ref<Responsavel[]>([])

watch(() => props.aberto, async (aberto) => {
  if (!aberto) return
  const c = props.cliente
  Object.assign(f, {
    nome: c?.nome ?? '', fone: c ? mascaraFone(c.fone) : '', cpf: c?.cpf ? mascaraCpf(c.cpf) : '', rg: c?.rg ?? '',
    endereco: c?.endereco ?? '', origem: c?.origem ?? '', responsavelId: c?.responsavelId ? String(c.responsavelId) : '',
  })
  Object.keys(erros).forEach((k) => delete erros[k])
  erroGeral.value = ''
  if (ehAdmin.value && !responsaveis.value.length) responsaveis.value = await clientesApi.responsaveis(sessao.value).catch(() => [])
}, { immediate: true })

/** Confere no próprio formulário antes de enviar (o servidor confere de novo). */
function validar(): boolean {
  Object.keys(erros).forEach((k) => delete erros[k])
  if (f.nome.trim().length < 2) erros.nome = 'Informe o nome (ao menos 2 letras)'
  if (!normalizarFone(f.fone)) erros.fone = 'Use DDD + número, por exemplo (11) 98812-4410'
  if (ehIndicador.value && !f.cpf.trim()) erros.cpf = 'Informe o CPF do cliente'
  else if (f.cpf.trim() && !cpfValido(f.cpf)) erros.cpf = 'CPF inválido'
  return Object.keys(erros).length === 0
}

async function enviar() {
  if (enviando.value || !validar()) return
  enviando.value = true
  erroGeral.value = ''
  const dados: EntradaCliente = { nome: f.nome, fone: f.fone, cpf: f.cpf || null, rg: f.rg || null, endereco: f.endereco || null, origem: f.origem || null }
  if (ehAdmin.value) dados.responsavelId = f.responsavelId ? Number(f.responsavelId) : null
  try {
    const r = props.cliente
      ? await clientesApi.atualizar(sessao.value, props.cliente.id, dados)
      : await clientesApi.criar(sessao.value, dados)
    emit('salvo', r)
  } catch (e) {
    const msg = e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.'
    if (e instanceof ErroApi && e.codigo === 'CPF_DUPLICADO') erros.cpf = msg
    else erroGeral.value = msg
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <Sheet :aberto="aberto" @fechar="emit('fechar')">
    <h3>{{ editando ? 'Editar cliente' : 'Novo cliente' }}</h3>
    <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px" novalidate @submit.prevent="enviar">
      <div class="field">
        <label for="cNome">Nome completo *</label>
        <div class="inp"><input id="cNome" v-model="f.nome" autocomplete="off" autofocus /></div>
        <span v-if="erros.nome" class="erro-campo">{{ erros.nome }}</span>
      </div>
      <div class="grid2">
        <div class="field">
          <label for="cFone">WhatsApp *</label>
          <div class="inp"><input id="cFone" v-model="f.fone" inputmode="tel" placeholder="(11) 98812-4410" @input="f.fone = mascaraFone(f.fone)" /></div>
          <span v-if="erros.fone" class="erro-campo">{{ erros.fone }}</span>
        </div>
        <div class="field">
          <label for="cCpf">CPF{{ ehIndicador ? ' *' : '' }}</label>
          <div class="inp"><input id="cCpf" v-model="f.cpf" inputmode="numeric" placeholder="000.000.000-00" @input="f.cpf = mascaraCpf(f.cpf)" /></div>
          <span v-if="erros.cpf" class="erro-campo">{{ erros.cpf }}</span>
        </div>
      </div>
      <div class="grid2">
        <div class="field"><label for="cRg">RG</label><div class="inp"><input id="cRg" v-model="f.rg" autocomplete="off" /></div></div>
        <div class="field">
          <label for="cOrigem">Como chegou</label>
          <div class="inp"><input id="cOrigem" v-model="f.origem" list="origens" autocomplete="off" /><datalist id="origens"><option v-for="o in ORIGENS" :key="o" :value="o" /></datalist></div>
        </div>
      </div>
      <div class="field"><label for="cEnd">Endereço</label><div class="inp"><input id="cEnd" v-model="f.endereco" autocomplete="off" /></div></div>
      <div v-if="ehAdmin" class="field">
        <label for="cResp">Responsável (carteira)</label>
        <div class="inp"><select id="cResp" v-model="f.responsavelId"><option value="">Sem responsável</option><option v-for="u in responsaveis" :key="u.id" :value="String(u.id)">{{ u.nome }}</option></select></div>
      </div>
      <p v-if="ehIndicador && !editando" class="small" style="margin: 0">O cliente fica ligado a você e a loja cuida do resto.</p>
      <p v-else-if="!pode.verCustoELucro && !editando" class="small" style="margin: 0">O cliente entra na sua carteira.</p>

      <div v-if="erroGeral" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erroGeral }}</div>
      <button class="btn b-pri b-block" type="submit" :disabled="enviando">{{ enviando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Cadastrar cliente' }}</button>
    </form>
  </Sheet>
</template>

<style scoped>
.erro-campo { font-size: 12px; color: var(--bad); font-weight: 500; }
</style>
