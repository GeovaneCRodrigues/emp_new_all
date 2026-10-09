<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { EntradaIndicador, IndicadorApi } from '@/api/indicadores'
import { indicadoresApi } from '@/api/recursos'
import { useApp } from '@/composables/useApp'
import { mascaraFone, normalizarFone } from '@/domain/documentos'
import Sheet from './Sheet.vue'

const props = defineProps<{ aberto: boolean; indicador: IndicadorApi | null }>()
const emit = defineEmits<{ fechar: []; salvo: [i: IndicadorApi] }>()

const { sessao } = useApp()
const editando = computed(() => props.indicador !== null)
const OPCOES = [10, 20, 30, 40, 50, 55]

const f = reactive({ nome: '', whatsapp: '', chavePix: '', automatico: false, pctTexto: '50' })
const erros = reactive<Record<string, string>>({})
const erroGeral = ref('')
const enviando = ref(false)

watch(() => props.aberto, (aberto) => {
  if (!aberto) return
  const i = props.indicador
  Object.assign(f, {
    nome: i?.nome ?? '', whatsapp: i?.whatsapp ? mascaraFone(i.whatsapp) : '', chavePix: i?.chavePix ?? '',
    automatico: i ? !i.pctManual : false, pctTexto: String(Math.round((i?.pct ?? 0.5) * 100)),
  })
  Object.keys(erros).forEach((k) => delete erros[k])
  erroGeral.value = ''
}, { immediate: true })

const pct = computed(() => Number(f.pctTexto.replace(',', '.')))

function validar(): boolean {
  Object.keys(erros).forEach((k) => delete erros[k])
  if (f.nome.trim().length < 2) erros.nome = 'Informe o nome (ao menos 2 letras)'
  if (f.whatsapp.trim() && !normalizarFone(f.whatsapp)) erros.whatsapp = 'Use DDD + número, por exemplo (11) 98812-4410'
  if (!f.automatico && !(pct.value > 0 && pct.value <= 100)) erros.pct = 'Informe um % entre 1 e 100'
  return Object.keys(erros).length === 0
}

async function enviar() {
  if (enviando.value || !validar()) return
  enviando.value = true
  erroGeral.value = ''
  const dados: EntradaIndicador = { nome: f.nome, whatsapp: f.whatsapp || null, chavePix: f.chavePix || null }
  if (f.automatico) dados.automatico = true
  else dados.pct = Math.round(pct.value * 100) / 10000
  try {
    const r = props.indicador
      ? await indicadoresApi.atualizar(sessao.value, props.indicador.id, dados)
      : await indicadoresApi.criar(sessao.value, { ...dados, nome: f.nome })
    emit('salvo', r)
  } catch (e) {
    erroGeral.value = e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.'
  } finally {
    enviando.value = false
  }
}
</script>

<template>
  <Sheet :aberto="aberto" @fechar="emit('fechar')">
    <h3>{{ editando ? 'Editar indicador' : 'Novo indicador' }}</h3>
    <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px" novalidate @submit.prevent="enviar">
      <div class="field">
        <label for="iNome">Nome *</label>
        <div class="inp maiusc"><input id="iNome" v-model="f.nome" autocomplete="off" autofocus /></div>
        <span v-if="erros.nome" class="erro-campo">{{ erros.nome }}</span>
      </div>
      <div class="grid2">
        <div class="field">
          <label for="iZap">WhatsApp</label>
          <div class="inp"><input id="iZap" v-model="f.whatsapp" inputmode="tel" placeholder="(11) 98812-4410" @input="f.whatsapp = mascaraFone(f.whatsapp)" /></div>
          <span v-if="erros.whatsapp" class="erro-campo">{{ erros.whatsapp }}</span>
        </div>
        <div class="field"><label for="iPix">Chave Pix</label><div class="inp"><input id="iPix" v-model="f.chavePix" autocomplete="off" /></div></div>
      </div>

      <div class="field">
        <label>Parte do lucro dele</label>
        <div class="pills">
          <button v-for="o in OPCOES" :key="o" type="button" class="pill" :class="{ on: !f.automatico && pct === o }" @click="f.automatico = false; f.pctTexto = String(o)">{{ o }}%</button>
          <button type="button" class="pill" :class="{ on: f.automatico }" @click="f.automatico = true">Automático</button>
        </div>
        <div v-if="!f.automatico" class="inp" style="max-width: 140px"><input v-model="f.pctTexto" inputmode="decimal" aria-label="Percentual do lucro" /><span>%</span></div>
        <span v-if="erros.pct" class="erro-campo">{{ erros.pct }}</span>
        <span class="small">{{ f.automatico ? 'O % acompanha o nível dele: quanto mais indica, mais ganha.' : 'Fixado por você: não muda sozinho com o nível.' }} Vale só para as próximas operações; as que já existem ficam com o % de quando foram feitas.</span>
      </div>

      <div v-if="erroGeral" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erroGeral }}</div>
      <button class="btn b-pri b-block" type="submit" :disabled="enviando">{{ enviando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Cadastrar indicador' }}</button>
    </form>
  </Sheet>
</template>

<style scoped>
.erro-campo { font-size: 12px; color: var(--bad); font-weight: 500; }
</style>
