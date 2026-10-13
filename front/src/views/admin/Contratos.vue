<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { ContratoItemApi, EmpresaApi, ListaContratosApi, ModeloApi, PreviaApi } from '@/api/contratos'
import { contratosApi } from '@/api/recursos'
import Abas from '@/components/Abas.vue'
import ContratoFicha from '@/components/ContratoFicha.vue'
import Icon from '@/components/Icon.vue'
import Seg from '@/components/Seg.vue'
import { useApp } from '@/composables/useApp'
import { dmy, moneyBR, numBR } from '@/domain/format'

/** Contratos das vendas de iPhone: a lista com o status, o texto do modelo e os dados da empresa (só o administrador). */
const { sessao } = useApp()

const aba = ref('lista')
const lista = ref<ListaContratosApi | null>(null)
const carregando = ref(true)
const erro = ref('')
const filtro = ref('TODOS')
const aberto = ref<number | null>(null)

let pedido = 0
async function carregar() {
  const meu = ++pedido
  carregando.value = true; erro.value = ''
  try { const r = await contratosApi.listar(sessao.value); if (meu === pedido) lista.value = r } catch (e) { if (meu === pedido) erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar os contratos.' } finally { if (meu === pedido) carregando.value = false }
}
onMounted(carregar)

const ABAS = computed(() => [
  { id: 'lista', label: 'Contratos', icon: 'file-signature', n: lista.value?.resumo.esperando ?? 0 },
  { id: 'modelo', label: 'Modelo', icon: 'receipt-text' },
  { id: 'empresa', label: 'Empresa e taxas', icon: 'landmark' },
])
const FILTROS = computed(() => [{ id: 'TODOS', label: 'Todos' }, { id: 'ESPERANDO', label: `Esperando · ${lista.value?.resumo.esperando ?? 0}` }, { id: 'ASSINADO', label: 'Assinados' }])
const visiveis = computed(() => (lista.value?.itens ?? []).filter((c) => (filtro.value === 'ASSINADO' ? c.status === 'ASSINADO' : filtro.value === 'ESPERANDO' ? c.status !== 'ASSINADO' && c.vendaStatus !== 'RETOMADA' && c.vendaStatus !== 'CANCELADA' : true)))
const statusChip = (c: ContratoItemApi) => (c.status === 'ASSINADO' ? { cls: 'c-ok', txt: 'assinado' } : c.vendaStatus === 'RETOMADA' ? { cls: 'c-neu', txt: 'venda retomada' } : { cls: 'c-warn', txt: 'esperando assinatura' })

// ---------- modelo ----------
const modelo = ref<ModeloApi | null>(null)
const texto = ref('')
const previa = ref<PreviaApi | null>(null)
const verPreenchido = ref(false)
const exemploId = ref<number | null>(null)
const modeloErro = ref('')
const modeloMsg = ref('')
const salvando = ref(false)
const area = ref<HTMLTextAreaElement | null>(null)

async function abrirModelo() {
  modeloErro.value = ''; modeloMsg.value = ''
  try { modelo.value = await contratosApi.modelo(sessao.value); texto.value = modelo.value.texto } catch (e) { modeloErro.value = e instanceof ErroApi ? e.message : 'Não consegui abrir o modelo.' }
  if (exemploId.value === null) exemploId.value = lista.value?.itens[0]?.vendaId ?? null
}
async function atualizarPrevia() {
  if (!verPreenchido.value) return
  if (exemploId.value === null) { modeloErro.value = 'Ainda não há venda para usar de exemplo.'; verPreenchido.value = false; return }
  modeloErro.value = ''
  try { previa.value = await contratosApi.previa(sessao.value, texto.value, exemploId.value) } catch (e) { modeloErro.value = e instanceof ErroApi ? e.message : 'Não consegui preencher o exemplo.'; verPreenchido.value = false }
}
watch([verPreenchido, exemploId], atualizarPrevia)
const mudou = computed(() => !!modelo.value && texto.value !== modelo.value.texto)
const grupos = computed(() => { const g = new Map<string, ModeloApi['variaveis']>(); for (const v of modelo.value?.variaveis ?? []) g.set(v.grupo, [...(g.get(v.grupo) ?? []), v]); return [...g] })
async function inserir(chave: string) {
  const el = area.value; if (!el) return
  const a = el.selectionStart ?? texto.value.length, b = el.selectionEnd ?? a, ins = `{{${chave}}}`
  texto.value = texto.value.slice(0, a) + ins + texto.value.slice(b)
  await nextTick(); el.focus(); el.setSelectionRange(a + ins.length, a + ins.length)
}
async function salvarModelo() {
  salvando.value = true; modeloErro.value = ''; modeloMsg.value = ''
  try { modelo.value = await contratosApi.salvarModelo(sessao.value, texto.value); texto.value = modelo.value.texto; modeloMsg.value = `Modelo salvo · versão ${modelo.value.versao}` } catch (e) { modeloErro.value = e instanceof ErroApi ? e.message : 'Não consegui salvar.' } finally { salvando.value = false }
}
const voltarAoPadrao = () => { if (modelo.value) { texto.value = modelo.value.padrao; modeloMsg.value = 'Texto padrão de volta. Salve para valer.' } }

// ---------- empresa ----------
type Form = { nome: string; cnpj: string; endereco: string; email: string; atendente: string; avaria: string; reposicao: string; seguro: string; cancelamentoPct: string; recuperacao: string }
const form = ref<Form | null>(null)
const empresaErro = ref('')
const empresaMsg = ref('')
const dinheiroTxt = (v: number | null) => (v === null ? '' : moneyBR(v))
const pctTxt = (v: number | null) => (v === null ? '' : String(v).replace('.', ','))
async function abrirEmpresa() {
  empresaErro.value = ''; empresaMsg.value = ''
  try {
    const e: EmpresaApi = await contratosApi.empresa(sessao.value)
    form.value = { nome: e.nome, cnpj: e.cnpj ?? '', endereco: e.endereco ?? '', email: e.email ?? '', atendente: e.atendente ?? '', avaria: dinheiroTxt(e.avaria), reposicao: dinheiroTxt(e.reposicao), seguro: dinheiroTxt(e.seguro), cancelamentoPct: pctTxt(e.cancelamentoPct), recuperacao: dinheiroTxt(e.recuperacao) }
  } catch (e) { empresaErro.value = e instanceof ErroApi ? e.message : 'Não consegui abrir os dados.' }
}
const num = (t: string) => (t.trim() === '' ? null : numBR(t))
async function salvarEmpresa() {
  if (!form.value) return
  const f = form.value
  salvando.value = true; empresaErro.value = ''; empresaMsg.value = ''
  try {
    await contratosApi.salvarEmpresa(sessao.value, { nome: f.nome, cnpj: f.cnpj.trim() || null, endereco: f.endereco.trim() || null, email: f.email.trim() || null, atendente: f.atendente.trim() || null, avaria: num(f.avaria), reposicao: num(f.reposicao), seguro: num(f.seguro), cancelamentoPct: num(f.cancelamentoPct), recuperacao: num(f.recuperacao) })
    empresaMsg.value = 'Dados da empresa e taxas salvos'
    await abrirEmpresa(); empresaMsg.value = 'Dados da empresa e taxas salvos'
  } catch (e) { empresaErro.value = e instanceof ErroApi ? e.message : 'Não consegui salvar.' } finally { salvando.value = false }
}
watch(aba, (a) => { if (a === 'modelo' && !modelo.value) abrirModelo(); if (a === 'empresa' && !form.value) abrirEmpresa() })
</script>

<template>
  <Abas v-model="aba" :itens="ABAS" data-testid="ct-abas" />
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar">Tentar de novo</button></div>

  <!-- lista -->
  <template v-if="aba === 'lista'">
    <div v-if="carregando && !lista" class="empty">Carregando…</div>
    <template v-if="lista">
      <div class="resumo3" data-testid="ct-resumo">
        <div><div class="lbl">Assinados</div><div class="val num" style="color: var(--ok)" data-testid="ct-assinados">{{ lista.resumo.assinados }}</div></div>
        <div><div class="lbl">Esperando</div><div class="val num" :style="lista.resumo.esperando ? 'color: var(--warn)' : ''" data-testid="ct-esperando">{{ lista.resumo.esperando }}</div></div>
        <div><div class="lbl">Com seguro</div><div class="val num" data-testid="ct-seguro">{{ lista.resumo.comSeguro }}</div></div>
      </div>
      <Seg v-model="filtro" :itens="FILTROS" data-testid="ct-filtro" />
      <div class="card list" data-testid="ct-lista">
        <button v-for="c in visiveis" :key="c.id" class="li" :data-contrato="c.id" :data-status="c.status" @click="aberto = c.id">
          <span class="ini" style="background: var(--primary-soft); color: var(--primary)"><Icon name="file-signature" small /></span>
          <span class="mid"><span class="t" style="display: block">{{ c.clienteNome }}</span><span class="s" style="display: block">Nº {{ c.numero }} · {{ c.aparelho }} · {{ dmy(c.dataVenda) }}{{ c.seguro ? ' · com seguro' : '' }}</span></span>
          <span class="chip" :class="statusChip(c).cls">{{ statusChip(c).txt }}</span>
        </button>
        <div v-if="!visiveis.length" class="empty" data-testid="ct-vazio">{{ lista.itens.length ? 'Nada aqui.' : 'Nenhum contrato ainda. Cada venda nova gera o seu.' }}</div>
      </div>
      <div class="small">As vendas antigas, trazidas do sistema anterior, não tinham contrato e não aparecem aqui.</div>
    </template>
  </template>

  <!-- modelo -->
  <div v-else-if="aba === 'modelo'" class="ct-grid" data-testid="ct-modelo">
    <div v-if="modeloErro && !modelo" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ modeloErro }}</div>
    <template v-if="modelo">
      <div class="card pad" style="display: flex; flex-direction: column; gap: 12px; min-width: 0">
        <div class="between" style="flex-wrap: wrap; gap: 8px">
          <div><div class="val">Locação de aparelho</div><div class="small" data-testid="ct-versao">{{ modelo.versao > 0 ? `Versão ${modelo.versao}` : 'Texto padrão do sistema' }} · usado em todas as vendas novas</div></div>
          <span class="seg"><button :class="{ on: !verPreenchido }" data-testid="ct-editar" @click="verPreenchido = false">Editar</button><button :class="{ on: verPreenchido }" data-testid="ct-ver" @click="verPreenchido = true">Ver preenchido</button></span>
        </div>
        <template v-if="verPreenchido && previa">
          <label class="small" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">Exemplo com a venda de
            <select v-model.number="exemploId" class="inp" style="height: 36px; width: auto" data-testid="ct-exemplo"><option v-for="c in lista?.itens" :key="c.vendaId" :value="c.vendaId">{{ c.clienteNome }} · {{ c.numero }}</option></select>
          </label>
          <div class="small">Em verde o que veio do sistema, em laranja o que falta cadastrar.</div>
          <div class="papel" data-testid="ct-previa"><template v-for="(t, i) in previa.trechos" :key="i"><mark v-if="t.tipo === 'ok'">{{ t.v }}</mark><mark v-else-if="t.tipo === 'falta' || t.tipo === 'desconhecido'" class="f">{{ t.v }}</mark><template v-else>{{ t.v }}</template></template></div>
        </template>
        <textarea v-else ref="area" v-model="texto" class="ta" spellcheck="false" data-testid="ct-texto" />
        <div v-if="modeloErro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)" data-testid="ct-modelo-erro">{{ modeloErro }}</div>
        <div v-if="modeloMsg" class="small" role="status" style="color: var(--ok)" data-testid="ct-modelo-msg">{{ modeloMsg }}</div>
        <div class="row" style="gap: 8px; flex-wrap: wrap; justify-content: flex-end">
          <button class="btn b-ghost" data-testid="ct-padrao" @click="voltarAoPadrao">Voltar ao padrão</button>
          <button class="btn b-pri" :disabled="salvando || !mudou" data-testid="ct-salvar-modelo" @click="salvarModelo"><Icon name="check" small />Salvar modelo</button>
        </div>
        <div class="small">Contratos já enviados não mudam. O modelo novo vale a partir da próxima venda.</div>
      </div>
      <div class="card pad" style="display: flex; flex-direction: column; gap: 12px; align-self: start">
        <div><div class="val">Campos automáticos</div><div class="small">{{ verPreenchido ? 'Volte em Editar para inserir.' : 'Toque para inserir onde está o cursor.' }}</div></div>
        <div v-for="[g, vs] in grupos" :key="g"><div class="lbl" style="margin-bottom: 6px">{{ g }}</div><div class="pills"><button v-for="v in vs" :key="v.chave" class="pill" :disabled="verPreenchido" :data-var="v.chave" @click="inserir(v.chave)">{{ v.rotulo }}</button></div></div>
      </div>
    </template>
  </div>

  <!-- empresa -->
  <template v-else>
    <div v-if="empresaErro && !form" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ empresaErro }}</div>
    <form v-if="form" style="display: flex; flex-direction: column; gap: 14px" data-testid="ct-empresa" @submit.prevent="salvarEmpresa">
      <div class="card pad" style="display: flex; flex-direction: column; gap: 12px">
        <div><div class="val">Dados da empresa</div><div class="small">Saem no cabeçalho de todo contrato.</div></div>
        <div class="duo">
          <div class="field"><label for="eNome">Razão social</label><div class="inp"><input id="eNome" v-model="form.nome" maxlength="120" /></div></div>
          <div class="field"><label for="eCnpj">CNPJ</label><div class="inp"><input id="eCnpj" v-model="form.cnpj" inputmode="numeric" maxlength="18" placeholder="00.000.000/0001-00" /></div></div>
          <div class="field"><label for="eEmail">E-mail</label><div class="inp"><input id="eEmail" v-model="form.email" type="email" maxlength="120" /></div></div>
          <div class="field"><label for="eAtend">Atendente que assina</label><div class="inp"><input id="eAtend" v-model="form.atendente" maxlength="80" /></div></div>
        </div>
        <div class="field"><label for="eEnd">Endereço</label><div class="inp"><input id="eEnd" v-model="form.endereco" maxlength="200" /></div></div>
      </div>
      <div class="card pad" style="display: flex; flex-direction: column; gap: 12px">
        <div><div class="val">Taxas do contrato</div><div class="small">Valem para os próximos contratos. Deixe em branco o que não se aplica: o contrato só sai com todos os campos preenchidos.</div></div>
        <div class="duo">
          <div class="field"><label for="tAvaria">Avaria do aparelho</label><div class="inp"><span>R$</span><input id="tAvaria" v-model="form.avaria" inputmode="decimal" /></div><div class="small">Cobrada se o aparelho voltar danificado.</div></div>
          <div class="field"><label for="tRepo">Reposição (perda, furto ou roubo)</label><div class="inp"><span>R$</span><input id="tRepo" v-model="form.reposicao" inputmode="decimal" /></div><div class="small">Valor para repor o aparelho.</div></div>
          <div class="field"><label for="tSeguro">Seguro por mês</label><div class="inp"><span>R$</span><input id="tSeguro" v-model="form.seguro" inputmode="decimal" /></div><div class="small">Se o cliente quiser, entra junto da parcela.</div></div>
          <div class="field"><label for="tCanc">Multa de cancelamento</label><div class="inp"><input id="tCanc" v-model="form.cancelamentoPct" inputmode="decimal" /><span>%</span></div><div class="small">Sobre o saldo em aberto, se o cliente desistir.</div></div>
          <div class="field"><label for="tRecup">Recuperação por atraso</label><div class="inp"><span>R$</span><input id="tRecup" v-model="form.recuperacao" inputmode="decimal" /></div><div class="small">Quando é preciso ir buscar o aparelho.</div></div>
        </div>
      </div>
      <div class="card pad"><div class="between"><div><div class="val">Assinatura eletrônica</div><div class="small">ZapSign: entra numa próxima etapa. Por enquanto você copia o texto, manda ao cliente e marca como enviado e assinado.</div></div><span class="chip c-neu">não conectada</span></div></div>
      <div v-if="empresaErro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)" data-testid="ct-empresa-erro">{{ empresaErro }}</div>
      <div v-if="empresaMsg" class="small" role="status" style="color: var(--ok)" data-testid="ct-empresa-msg">{{ empresaMsg }}</div>
      <button class="btn b-pri b-block" type="submit" :disabled="salvando || !form.nome.trim()" data-testid="ct-salvar-empresa"><Icon name="check" small />Salvar</button>
    </form>
  </template>

  <ContratoFicha :contrato-id="aberto" @fechar="aberto = null" @mudou="carregar" />
</template>
