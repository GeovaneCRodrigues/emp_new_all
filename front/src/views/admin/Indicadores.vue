<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { AcessoCriado, IndicadorApi, TabelaNiveis } from '@/api/indicadores'
import type { DetalheRepasseApi, RepasseApi, ResumoDoIndicadorApi } from '@/api/repasses'
import { indicadoresApi, repassesApi } from '@/api/recursos'
import Abas from '@/components/Abas.vue'
import CampoBusca from '@/components/CampoBusca.vue'
import Icon from '@/components/Icon.vue'
import IndicadorForm from '@/components/IndicadorForm.vue'
import PagarRepasseForm from '@/components/PagarRepasseForm.vue'
import RepasseOps from '@/components/RepasseOps.vue'
import SeloNivel from '@/components/SeloNivel.vue'
import Sheet from '@/components/Sheet.vue'
import { modoDemo } from '@/composables/useAuth'
import { useApp } from '@/composables/useApp'
import { casaBusca } from '@/domain/busca'
import { mascaraFone } from '@/domain/documentos'
import { dmyA, fmt, iniciais } from '@/domain/format'
import { validarNiveis } from '@/domain/repasse'

const { sessao } = useApp()

const aba = ref('repasses')
const abas = [
  { id: 'repasses', label: 'Repasses', icon: 'send' },
  { id: 'indicadores', label: 'Indicadores', icon: 'share-2' },
  { id: 'niveis', label: 'Níveis', icon: 'award' },
  { id: 'pagos', label: 'Já pagos', icon: 'wallet' },
]

const lista = ref<IndicadorApi[]>([])
// as listas vêm inteiras: a busca só esconde cartões (os totais seguem sendo os de todos)
const busca = ref('')
const listaVisivel = computed(() => lista.value.filter((i) => casaBusca([i.nome], busca.value)))
const carregando = ref(true)
const erro = ref('')
const aviso = ref('')
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`

async function carregar() {
  erro.value = ''
  try {
    lista.value = await indicadoresApi.listar(sessao.value)
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar os indicadores.'
  } finally {
    carregando.value = false
  }
}
onMounted(() => { carregar(); carregarNiveis(); carregarRepasses() })

// ---- repasses ----
const repasses = ref<{ item: ResumoDoIndicadorApi; detalhe: DetalheRepasseApi }[]>([])
const pagos = ref<RepasseApi[]>([])
const repassesVisiveis = computed(() => repasses.value.filter((r) => casaBusca([r.item.indicador.nome], busca.value)))
const filtroPagos = ref('todos')
const carregandoRep = ref(true)
const erroRep = ref('')
const pagando = ref<ResumoDoIndicadorApi | null>(null)

async function carregarRepasses() {
  erroRep.value = ''
  try {
    const resumo = await repassesApi.resumo(sessao.value)
    const comMovimento = resumo.filter((r) => r.nOperacoes > 0 || r.resumo.pago > 0)
    repasses.value = await Promise.all(comMovimento.map(async (item) => ({ item, detalhe: await repassesApi.detalhe(sessao.value, item.indicador.id) })))
    pagos.value = await repassesApi.jaPagos(sessao.value)
  } catch (e) {
    erroRep.value = e instanceof ErroApi ? e.message : 'Não consegui carregar os repasses.'
  } finally {
    carregandoRep.value = false
  }
}
async function aoPagar(r: RepasseApi) {
  pagando.value = null
  aviso.value = `Repasse de ${fmt(r.valor)} para ${r.indicadorNome} registrado.`
  await carregarRepasses()
}
const nivelDe = (id: number) => lista.value.find((i) => i.id === id)
const totais = computed(() => ({
  aPagar: Math.round(repasses.value.reduce((x, r) => x + r.item.resumo.aPagar, 0) * 100) / 100,
  pago: Math.round(repasses.value.reduce((x, r) => x + r.item.resumo.pago, 0) * 100) / 100,
  vaiLiberar: Math.round(repasses.value.reduce((x, r) => x + r.item.resumo.vaiLiberar, 0) * 100) / 100,
}))
const pagosFiltrados = computed(() => pagos.value.filter((p) => filtroPagos.value === 'todos' || String(p.indicadorId) === filtroPagos.value))
const totalPagosFiltrados = computed(() => Math.round(pagosFiltrados.value.reduce((x, p) => x + p.valor, 0) * 100) / 100)
const NOME_FORMA = { PIX: 'Pix', DINHEIRO: 'Dinheiro', TRANSFERENCIA: 'Transferência' } as const


// ---- ficha e cadastro ----
const ficha = ref<IndicadorApi | null>(null)
const formAberto = ref(false)
const editando = ref<IndicadorApi | null>(null)
const mudando = ref(false)

const novo = () => { editando.value = null; formAberto.value = true }
const editar = (i: IndicadorApi) => { editando.value = i; ficha.value = null; formAberto.value = true }
async function aoSalvar(i: IndicadorApi) {
  formAberto.value = false
  aviso.value = ''
  await carregar()
  if (ficha.value) ficha.value = lista.value.find((x) => x.id === i.id) ?? null
}

async function alternarAtivo(i: IndicadorApi) {
  mudando.value = true
  try {
    await indicadoresApi.atualizar(sessao.value, i.id, { ativo: !i.ativo })
    await carregar()
    ficha.value = lista.value.find((x) => x.id === i.id) ?? null
  } catch (e) {
    aviso.value = e instanceof ErroApi ? e.message : 'Não consegui mudar o indicador.'
  } finally {
    mudando.value = false
  }
}

// ---- acesso ----
const acessoPara = ref<IndicadorApi | null>(null)
const emailAcesso = ref('')
const erroAcesso = ref('')
const acesso = ref<AcessoCriado | null>(null)
const copiado = ref(false)

function abrirAcesso(i: IndicadorApi) { ficha.value = null; acessoPara.value = i; emailAcesso.value = ''; erroAcesso.value = ''; acesso.value = null; copiado.value = false }
async function criarAcesso() {
  if (!acessoPara.value) return
  erroAcesso.value = ''
  try {
    acesso.value = await indicadoresApi.criarAcesso(sessao.value, acessoPara.value.id, emailAcesso.value)
    carregar()
  } catch (e) {
    erroAcesso.value = e instanceof ErroApi ? e.message : 'Não consegui criar o acesso.'
  }
}
async function copiarAcesso() {
  if (!acesso.value) return
  try { await navigator.clipboard.writeText(`E-mail: ${acesso.value.email}\nSenha temporária: ${acesso.value.senhaTemporaria}`); copiado.value = true } catch { /* o texto está na tela */ }
}
// a senha aparece uma vez: fechar descarta
const fecharAcesso = () => { acessoPara.value = null; acesso.value = null }

// ---- níveis ----
const niveis = ref<TabelaNiveis | null>(null)
const edicao = reactive({ min: [] as string[], pct: [] as string[], auto: true })
const erroNiveis = ref('')
const salvoNiveis = ref(false)

async function carregarNiveis() {
  try {
    niveis.value = await indicadoresApi.niveis(sessao.value)
    edicao.min = niveis.value.niveis.map((n) => String(n.minOperacoes))
    edicao.pct = niveis.value.niveis.map((n) => String(Math.round(n.pct * 1000) / 10))
    edicao.auto = niveis.value.auto
  } catch { /* a aba mostra vazio */ }
}
async function salvarNiveis() {
  if (!niveis.value) return
  erroNiveis.value = ''
  salvoNiveis.value = false
  const novos = niveis.value.niveis.map((n, i) => ({ ...n, minOperacoes: Number(edicao.min[i]), pct: Number(edicao.pct[i].replace(',', '.')) / 100 }))
  const problema = validarNiveis(novos.map((n) => ({ id: n.id, nome: n.nome, min: n.minOperacoes, pct: n.pct })))
  if (problema) { erroNiveis.value = problema; return }
  try {
    niveis.value = await indicadoresApi.salvarNiveis(sessao.value, { niveis: novos, auto: edicao.auto })
    salvoNiveis.value = true
    await carregar()
  } catch (e) {
    erroNiveis.value = e instanceof ErroApi ? e.message : 'Não consegui salvar os níveis.'
  }
}

const ativos = computed(() => lista.value.filter((i) => i.ativo).length)
const linkZap = (f: string) => `https://wa.me/55${f}`
</script>

<template>
  <div class="row" style="justify-content: space-between">
    <p class="small" style="margin: 0; flex: 1">Quem traz cliente ganha uma parte do lucro. A parte dele só começa depois que o seu capital volta.</p>
    <button v-if="aba === 'indicadores'" class="btn b-pri b-sm" @click="novo"><Icon name="plus" small />Indicador</button>
  </div>
  <Abas v-model="aba" :itens="abas" />

  <div v-if="aviso" class="aviso" role="status" style="justify-content: space-between"><span>{{ aviso }}</span><button class="btn b-ghost b-sm" @click="aviso = ''">Ok</button></div>

  <!-- repasses -->
  <template v-if="aba === 'repasses'">
    <div v-if="erroRep" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erroRep }}</span><button class="btn b-ghost b-sm" @click="carregarRepasses()">Tentar de novo</button></div>
    <div class="resumo3" data-testid="totais-repasse">
      <div><div class="lbl">A pagar</div><div class="val num" data-testid="total-a-pagar">{{ fmt(totais.aPagar) }}</div></div>
      <div><div class="lbl">Já pago</div><div class="val num">{{ fmt(totais.pago) }}</div></div>
      <div><div class="lbl">Vai liberar</div><div class="val num">{{ fmt(totais.vaiLiberar) }}</div></div>
    </div>
    <CampoBusca v-model="busca" placeholder="Buscar indicador" />
    <div v-if="busca.trim() && !repassesVisiveis.length" class="card empty">Nenhum indicador com esse nome.</div>
    <div v-for="{ item, detalhe } in repassesVisiveis" :key="item.indicador.id" class="card rep" :data-repasse="item.indicador.id" :style="{ opacity: item.indicador.ativo ? 1 : 0.7 }">
      <div class="row rep-topo">
        <span class="ini" style="background: var(--primary-soft); color: var(--primary)">{{ iniciais(item.indicador.nome) }}</span>
        <div style="flex: 1; min-width: 0">
          <div class="row" style="gap: 8px; flex-wrap: wrap"><span class="val">{{ item.indicador.nome }}</span><SeloNivel v-if="nivelDe(item.indicador.id)" :id="nivelDe(item.indicador.id)!.nivel.id" :nome="nivelDe(item.indicador.id)!.nivel.nome" /><span v-if="!item.indicador.ativo" class="chip c-neu">inativo</span></div>
          <div class="small">{{ item.nOperacoes }} {{ item.nOperacoes === 1 ? 'operação' : 'operações' }}<template v-if="nivelDe(item.indicador.id)"> · {{ pct(nivelDe(item.indicador.id)!.pct) }} do lucro</template></div>
        </div>
        <button class="btn b-pri b-sm" :disabled="item.resumo.aPagar <= 0" data-pagar @click="pagando = item">Pagar</button>
      </div>
      <div class="resumo3 rep-nums">
        <div><div class="lbl">A pagar</div><div class="val num" data-a-pagar>{{ fmt(item.resumo.aPagar) }}</div></div>
        <div><div class="lbl">Já pago</div><div class="val num" data-ja-pago>{{ fmt(item.resumo.pago) }}</div></div>
        <div><div class="lbl">Vai liberar</div><div class="val num">{{ fmt(item.resumo.vaiLiberar) }}</div></div>
      </div>
      <div v-if="item.resumo.pagoAMais > 0" class="aviso" role="status" style="margin: 10px 14px 0">Foi pago {{ fmt(item.resumo.pagoAMais) }} além do liberado (um recebimento foi desfeito depois do repasse). Não há nada a pagar até voltar a liberar.</div>
      <RepasseOps :operacoes="detalhe.operacoes" />
    </div>
    <div v-if="!repasses.length && !carregandoRep && !erroRep" class="card empty">Nenhum indicador trouxe operação ainda.</div>
  </template>

  <!-- já pagos -->
  <template v-else-if="aba === 'pagos'">
    <div class="row" style="gap: 10px; flex-wrap: wrap; justify-content: space-between">
      <select v-model="filtroPagos" class="inp" style="height: 38px; min-width: 200px" aria-label="Filtrar por indicador"><option value="todos">Todos os indicadores</option><option v-for="i in lista" :key="i.id" :value="String(i.id)">{{ i.nome }}</option></select>
      <div class="small">Total: <b class="num" data-testid="total-pagos">{{ fmt(totalPagosFiltrados) }}</b></div>
    </div>
    <div class="card list" data-testid="lista-pagos">
      <div v-for="p in pagosFiltrados" :key="p.id" class="li" :data-pago="p.id" style="cursor: default">
        <span class="ini" style="background: var(--primary-soft); color: var(--primary)">{{ iniciais(p.indicadorNome) }}</span>
        <div class="mid"><div class="t">{{ p.indicadorNome }}</div><div class="s">{{ dmyA(p.data) }} · {{ NOME_FORMA[p.forma] }}<template v-if="p.obs"> · {{ p.obs }}</template><template v-if="p.feitoPor"> · por {{ p.feitoPor }}</template></div></div>
        <b class="num">{{ fmt(p.valor) }}</b>
      </div>
      <div v-if="!pagosFiltrados.length" class="empty">Nenhum repasse registrado ainda.</div>
    </div>
  </template>

  <!-- indicadores -->
  <template v-else-if="aba === 'indicadores'">
    <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar()">Tentar de novo</button></div>
    <div class="resumo3">
      <div><div class="lbl">Indicadores</div><div class="val num">{{ ativos }}</div></div>
      <div><div class="lbl">Operações trazidas</div><div class="val num">{{ lista.reduce((s, i) => s + i.operacoes, 0) }}</div></div>
      <div><div class="lbl">Com acesso</div><div class="val num">{{ lista.filter((i) => i.temAcesso).length }}</div></div>
    </div>
    <CampoBusca v-model="busca" placeholder="Buscar indicador" />
    <div v-if="busca.trim() && !listaVisivel.length" class="card empty">Nenhum indicador com esse nome.</div>
    <div class="fones">
      <button v-for="i in listaVisivel" :key="i.id" class="card pad" style="text-align: left; display: flex; flex-direction: column; gap: 12px" :style="{ opacity: i.ativo ? 1 : 0.6 }" @click="ficha = i">
        <div class="row">
          <span class="ini" style="background: var(--primary-soft); color: var(--primary)">{{ iniciais(i.nome) }}</span>
          <div style="flex: 1; min-width: 0"><div class="val">{{ i.nome }}</div><div class="small">{{ i.whatsapp ? mascaraFone(i.whatsapp) : 'sem WhatsApp' }}</div></div>
          <span v-if="!i.ativo" class="chip c-neu">inativo</span>
          <SeloNivel :id="i.nivel.id" :nome="i.nivel.nome" />
          <span class="chip c-pri">{{ pct(i.pct) }}</span>
        </div>
        <div class="small">{{ i.operacoes }} {{ i.operacoes === 1 ? 'operação' : 'operações' }}<template v-if="i.proximoNivel"> · faltam {{ i.faltamParaProximo }} para {{ i.proximoNivel.nome }}</template></div>
      </button>
      <div v-if="!lista.length && !carregando && !erro" class="card empty">Nenhum indicador ainda.</div>
    </div>
  </template>

  <!-- níveis -->
  <div v-else-if="aba === 'niveis'" class="card pad" style="display: flex; flex-direction: column; gap: 14px">
    <div><div class="val">Níveis dos indicadores</div><div class="small">Quanto mais indica, mais sobe e mais ganha do lucro.</div></div>
    <div v-if="niveis" class="niveis">
      <div v-for="(n, i) in niveis.niveis" :key="n.id" class="niv" :style="{ borderColor: 'var(--border)' }">
        <SeloNivel :id="n.id" :nome="n.nome" grande />
        <div class="field"><label :for="'nm' + i">A partir de</label><div class="inp" style="height: 38px"><input :id="'nm' + i" v-model="edicao.min[i]" inputmode="numeric" :disabled="i === 0" style="font-size: 14px" /><span class="small">operações</span></div></div>
        <div class="field"><label :for="'np' + i">Ganha do lucro</label><div class="inp" style="height: 38px"><input :id="'np' + i" v-model="edicao.pct[i]" inputmode="decimal" style="font-size: 14px" /><span>%</span></div></div>
      </div>
    </div>
    <label class="toggle" style="cursor: pointer"><button type="button" class="sw" :class="{ on: edicao.auto }" role="switch" :aria-checked="edicao.auto" aria-label="Subir o % sozinho" @click="edicao.auto = !edicao.auto"></button><span><span class="val" style="display: block">Subir o % sozinho nas próximas operações</span><span class="small">Só vale para quem não teve o % definido à mão.</span></span></label>
    <div v-if="erroNiveis" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erroNiveis }}</div>
    <div v-if="salvoNiveis" class="aviso" role="status" style="background: var(--ok-soft); color: var(--ok)">Níveis salvos.</div>
    <button class="btn b-pri" style="align-self: flex-start" @click="salvarNiveis">Salvar níveis</button>
  </div>

  <!-- ficha -->
  <Sheet :aberto="ficha !== null" @fechar="ficha = null">
    <template v-if="ficha">
      <div class="row" style="gap: 12px"><span class="ini" style="background: var(--primary-soft); color: var(--primary)">{{ iniciais(ficha.nome) }}</span><div style="flex: 1; min-width: 0"><h3>{{ ficha.nome }}</h3><div class="small">{{ ficha.whatsapp ? mascaraFone(ficha.whatsapp) : 'sem WhatsApp' }}<template v-if="ficha.chavePix"> · Pix {{ ficha.chavePix }}</template></div></div><span v-if="!ficha.ativo" class="chip c-neu">inativo</span></div>
      <div class="dl card pad" style="margin-top: 14px">
        <div><div class="lbl">Nível</div><SeloNivel :id="ficha.nivel.id" :nome="ficha.nivel.nome" grande /></div>
        <div><div class="lbl">Parte do lucro</div><div class="val num">{{ pct(ficha.pct) }}</div><div class="small">{{ ficha.pctManual ? 'definido por você' : 'acompanha o nível' }}</div></div>
        <div><div class="lbl">Operações</div><div class="val num">{{ ficha.operacoes }}</div><div v-if="ficha.proximoNivel" class="small">faltam {{ ficha.faltamParaProximo }} para {{ ficha.proximoNivel.nome }}</div></div>
        <div><div class="lbl">Acesso ao sistema</div><div class="val">{{ ficha.temAcesso ? 'Criado' : 'Ainda não' }}</div></div>
      </div>
      <div class="small" style="margin-top: 8px">Mudar o % vale só para as próximas operações. As que já existem ficam com o % de quando foram feitas.</div>
      <div style="display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap">
        <button class="btn b-out" style="flex: 1" @click="editar(ficha)">Editar</button>
        <a v-if="ficha.whatsapp" class="btn b-out" style="flex: 1" :href="linkZap(ficha.whatsapp)" target="_blank" rel="noopener"><Icon name="message-circle" small />WhatsApp</a>
        <button v-if="!ficha.temAcesso && ficha.ativo" class="btn b-pri" style="flex-basis: 100%" @click="abrirAcesso(ficha)"><Icon name="key-round" small />Criar acesso ao sistema</button>
        <button class="btn b-sub" style="flex-basis: 100%" :disabled="mudando" @click="alternarAtivo(ficha)">{{ ficha.ativo ? 'Desativar indicador' : 'Reativar indicador' }}</button>
      </div>
      <div v-if="ficha.ativo" class="small" style="margin-top: 6px">Desativar também bloqueia o acesso dele. O histórico continua.</div>
    </template>
  </Sheet>

  <PagarRepasseForm :aberto="pagando !== null" :item="pagando" @fechar="pagando = null" @pago="aoPagar" />
  <IndicadorForm :aberto="formAberto" :indicador="editando" @fechar="formAberto = false" @salvo="aoSalvar" />

  <!-- acesso -->
  <Sheet :aberto="acessoPara !== null" @fechar="fecharAcesso">
    <template v-if="acessoPara">
      <h3>Acesso de {{ acessoPara.nome }}</h3>
      <form v-if="!acesso" style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px" @submit.prevent="criarAcesso">
        <div class="small">Ele entra com este e-mail e uma senha temporária que você vai ver uma única vez. No primeiro acesso ele escolhe a senha dele.</div>
        <div class="field"><label for="aMail">E-mail dele</label><div class="inp"><input id="aMail" v-model="emailAcesso" type="email" autocomplete="off" required autofocus /></div></div>
        <div v-if="erroAcesso" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erroAcesso }}</div>
        <button class="btn b-pri b-block" type="submit">Criar acesso</button>
      </form>
      <div v-else style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px">
        <div class="aviso">Anote agora: esta senha <b>não aparece de novo</b>. Se perder, é preciso criar outro acesso.</div>
        <div class="card pad" style="display: flex; flex-direction: column; gap: 8px"><div><div class="lbl">E-mail</div><div class="val">{{ acesso.email }}</div></div><div><div class="lbl">Senha temporária</div><div class="val mono" style="font-size: 16px" data-testid="senha-temporaria">{{ acesso.senhaTemporaria }}</div></div></div>
        <div v-if="modoDemo" class="small">Modo demonstração: esta senha é só para ver como fica, o login falso não a reconhece.</div>
        <button class="btn b-ok b-block" @click="copiarAcesso"><Icon name="copy" small />{{ copiado ? 'Copiado!' : 'Copiar e-mail e senha' }}</button>
        <button class="btn b-ghost" @click="fecharAcesso">Já anotei</button>
      </div>
    </template>
  </Sheet>
</template>

<style scoped>
.erro-campo { font-size: 12px; color: var(--bad); }
</style>
