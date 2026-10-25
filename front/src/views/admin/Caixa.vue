<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { carregarCadeia, PAGINA_CHEIA } from '@/api/paginar'
import RestanteDaLista from '@/components/RestanteDaLista.vue'
import { ErroApi } from '@/api/clientes'
import type { CaixaLojaApi, CategoriaMovimentoApi, FiltroLadoCaixa, LadoCaixa, LancamentoApi, MovimentoApi } from '@/api/caixa'
import type { ListaFechamentosLojaApi } from '@/api/caixaFechamentos'
import { caixaApi, caixaFechamentosApi } from '@/api/recursos'
import CampoBusca from '@/components/CampoBusca.vue'
import Icon from '@/components/Icon.vue'
import Seg from '@/components/Seg.vue'
import FecharCaixaSheet from '@/components/FecharCaixaSheet.vue'
import LancamentoCaixaForm from '@/components/LancamentoCaixaForm.vue'
import { useApp } from '@/composables/useApp'
import { useBusca } from '@/composables/useBusca'
import { mesNome } from '@/domain/cronograma'
import { dmy, dmyA, fmt, fmt0 } from '@/domain/format'

/** O caixa da loja: o saldo e o extrato do que entrou e saiu (só o administrador). */
const { sessao } = useApp()

const caixa = ref<CaixaLojaApi | null>(null)
const itens = ref<MovimentoApi[]>([])
const { busca } = useBusca(() => carregar())
const carregando = ref(true)
const erro = ref('')
const formAberto = ref(false)
const editando = ref<LancamentoApi | null>(null)
// o fechamento do caixa: o último dia fechado, quantos dias passaram sem fechar e o histórico
const fech = ref<ListaFechamentosLojaApi | null>(null)
const fecharAberto = ref(false)
const historicoAberto = ref(false)
const erroFech = ref('')
const desfazendo = ref(false)
const ultimo = computed(() => fech.value?.ultimo ?? null)
async function carregarFechamentos() {
  try { fech.value = await caixaFechamentosApi.listar(sessao.value) } catch { fech.value = null }
}
async function aposFechar() { fecharAberto.value = false; await carregarFechamentos() }
async function desfazerUltimo() {
  if (!ultimo.value || desfazendo.value) return
  desfazendo.value = true; erroFech.value = ''
  try { await caixaFechamentosApi.desfazer(sessao.value, ultimo.value.id); await carregarFechamentos() }
  catch (e) { erroFech.value = e instanceof ErroApi ? e.message : 'Não consegui desfazer o fechamento.' }
  finally { desfazendo.value = false }
}
const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).replace(',', ' às')
// a aba aberta: 'TUDO' soma os lados; cada lado tem o seu saldo e o seu extrato
const aba = ref<'TUDO' | FiltroLadoCaixa>('TUDO')
const NOME_ABA: Record<'TUDO' | FiltroLadoCaixa, string> = { TUDO: 'Tudo', EMPRESTIMO: 'Empréstimos', IPHONE: 'iPhones', SEM_LADO: 'Sem lado' }
// "Sem lado" (repasses e lançamentos antigos) só aparece quando há algo nela, ou enquanto está aberta
const abas = computed(() => (['TUDO', 'EMPRESTIMO', 'IPHONE', 'SEM_LADO'] as const)
  .filter((a) => a !== 'SEM_LADO' || aba.value === 'SEM_LADO' || (caixa.value?.porLado.SEM_LADO.saldo ?? 0) !== 0)
  .map((a) => ({ id: a, label: NOME_ABA[a] })))
const saldosPorLado = computed(() => (['EMPRESTIMO', 'IPHONE', 'SEM_LADO'] as const)
  .map((id) => ({ id, nome: NOME_ABA[id], saldo: caixa.value?.porLado[id].saldo ?? 0 }))
  .filter((l) => l.id !== 'SEM_LADO' || l.saldo !== 0))
const ladoDaAba = computed<LadoCaixa | undefined>(() => (aba.value === 'EMPRESTIMO' || aba.value === 'IPHONE' ? aba.value : undefined))

// uma resposta antiga que chega atrasada não pode sobrescrever a mais nova
let pedido = 0
async function carregar() {
  const meu = ++pedido
  carregando.value = true; erro.value = ''
  const [termo, s, filtro] = [busca.value.trim() || undefined, sessao.value, aba.value === 'TUDO' ? undefined : aba.value] // fixa o filtro desta carga
  const { primeira, fim } = carregarCadeia({
    buscar: (p) => caixaApi.ver(s, { pagina: p, limite: PAGINA_CHEIA, busca: termo, lado: filtro }),
    ativo: () => meu === pedido, mostrados: () => itens.value.length,
    // o resumo e o saldo vêm em toda página e são os mesmos; o extrato vai se juntando
    aplicar: (r, p) => { caixa.value = r; itens.value = p === 1 ? r.itens : [...itens.value, ...r.itens] },
  })
  fim.catch((e) => { if (meu === pedido) erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar o caixa.' }).finally(() => { if (meu === pedido) carregando.value = false })
  await primeira.catch(() => undefined)
}
onMounted(() => { carregar(); carregarFechamentos() })
watch(aba, () => { itens.value = []; carregar() })
onBeforeUnmount(() => { pedido++ }) // sair da tela cancela o que ainda está chegando

const ICONE: Record<CategoriaMovimentoApi, string> = {
  RECEBIMENTO: 'arrow-down-left', ENTRADA_VENDA: 'arrow-down-left', TRANSFERENCIA: 'arrow-down-left', APORTE: 'arrow-down-left',
  REPASSE: 'arrow-up-right', RETIRADA: 'arrow-up-right', DESPESA: 'arrow-up-right', EMPRESTIMO: 'arrow-up-right', COMPRA: 'arrow-up-right',
}

function novo() { editando.value = null; formAberto.value = true }
function editar(m: MovimentoApi) {
  if (m.manualId === null || (m.categoria !== 'APORTE' && m.categoria !== 'RETIRADA' && m.categoria !== 'DESPESA')) return
  // o título de um lançamento manual é a própria observação (ou o nome do tipo, quando não tem)
  const sem = m.titulo === m.sub
  editando.value = { id: m.manualId, tipo: m.categoria, valor: m.valor, data: m.data, obs: sem ? null : m.titulo, lado: m.lado }
  formAberto.value = true
}
async function aposSalvar() { formAberto.value = false; await carregar() }
</script>

<template>
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar()">Tentar de novo</button></div>

  <template v-if="caixa">
    <div class="hero" style="gap: 8px">
      <div class="between" style="gap: 8px; align-items: flex-start">
        <div class="lbl" data-testid="caixa-saldo-rotulo">{{ aba === 'TUDO' ? 'Saldo em caixa' : `Saldo · ${NOME_ABA[aba]}` }}</div>
        <button class="btn b-sm" style="background: rgba(255, 255, 255, 0.16); color: #fff" data-testid="caixa-lancar" @click="novo"><Icon name="plus" small />Lançar</button>
      </div>
      <div class="big disp num" data-testid="caixa-saldo" :style="caixa.saldo < 0 ? 'color: #ffd6cf' : ''">{{ fmt(caixa.saldo) }}</div>
      <div class="row" style="gap: 18px; flex-wrap: wrap">
        <span v-if="aba === 'TUDO'" class="lbl" data-testid="caixa-lados">
          <template v-for="(l, i) in saldosPorLado" :key="l.id">{{ i ? ' · ' : '' }}{{ l.nome }} <b>{{ fmt0(l.saldo) }}</b></template>
        </span>
        <span class="lbl" data-testid="caixa-mes"><span style="text-transform: capitalize">{{ mesNome(caixa.mes) }}</span>: <b style="color: #d8f5c0">+ {{ fmt0(caixa.entrouMes) }}</b> entrou · <b style="color: #ffd6cf">− {{ fmt0(caixa.saiuMes) }}</b> saiu</span>
      </div>
    </div>
    <div class="card pad" data-testid="caixa-fechamento" :data-atrasado="(fech?.diasSemFechar ?? 1) > 0 ? 'sim' : 'nao'" style="display: flex; flex-direction: column; gap: 8px">
      <div class="between" style="gap: 8px; align-items: flex-start">
        <div>
          <div class="lbl">Último fechamento</div>
          <div v-if="ultimo" class="num" style="font-weight: 700; font-size: 18px" data-testid="fechamento-ultimo">{{ dmyA(ultimo.dia) }}</div>
          <div v-else-if="fech" style="font-weight: 600" data-testid="fechamento-ultimo">Nunca fechou</div>
          <div v-if="ultimo" class="small" data-testid="fechamento-quando">fechado em {{ hora(ultimo.criadoEm) }} · {{ ultimo.por }}{{ ultimo.obs ? ` · ${ultimo.obs}` : '' }}</div>
        </div>
        <button class="btn b-pri b-sm" data-testid="fechar-caixa" @click="fecharAberto = true"><Icon name="check" small />Fechar o caixa</button>
      </div>
      <div v-if="fech && fech.diasSemFechar !== null && fech.diasSemFechar > 0" class="aviso" role="status" data-testid="fechamento-alerta">
        {{ fech.diasSemFechar }} dia{{ fech.diasSemFechar === 1 ? '' : 's' }} sem fechar (até ontem).
      </div>
      <div v-else-if="fech && fech.diasSemFechar === null" class="small" data-testid="fechamento-alerta">Ainda não há fechamento. Feche o dia anterior para começar a marcar.</div>
      <div v-if="erroFech" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erroFech }}</div>
      <div v-if="fech && fech.itens.length" class="row" style="gap: 8px; flex-wrap: wrap">
        <button class="btn b-ghost b-sm" data-testid="fechamento-historico" @click="historicoAberto = !historicoAberto">{{ historicoAberto ? 'Esconder' : 'Ver' }} fechamentos anteriores</button>
        <button class="btn b-ghost b-sm" :disabled="desfazendo" data-testid="fechamento-desfazer" @click="desfazerUltimo">Desfazer o último</button>
      </div>
      <div v-if="historicoAberto && fech" class="list" data-testid="fechamento-lista">
        <div v-for="f in fech.itens" :key="f.id" class="li" :data-fechamento="f.id">
          <span class="mid"><span class="t" style="display: block">Até {{ dmyA(f.dia) }}</span><span class="s" style="display: block">{{ hora(f.criadoEm) }} · {{ f.por }}{{ f.obs ? ` · ${f.obs}` : '' }}</span></span>
        </div>
      </div>
    </div>
    <Seg v-model="aba as string" :itens="abas" data-testid="caixa-abas" />
    <div v-if="aba === 'SEM_LADO'" class="small" data-testid="caixa-sem-lado">Repasses de indicador e lançamentos de antes dos lados. Abra um lançamento daqui e escolha se é de empréstimos ou de iPhones.</div>
    <div v-if="aba !== 'TUDO' && caixa.marcoZero" class="small" data-testid="caixa-marco">Contando a partir de {{ dmyA(caixa.marcoZero) }}, o primeiro aporte ou retirada lançado{{ aba === 'SEM_LADO' ? '' : ' deste lado' }}. O que veio antes não entra na conta.</div>
    <div v-else-if="aba === 'TUDO' && caixa.marcoZero" class="small" data-testid="caixa-marco">Cada caixa conta a partir do primeiro aporte ou retirada dele (o mais antigo é de {{ dmyA(caixa.marcoZero) }}). O que veio antes não entra na conta.</div>
    <div v-else class="small" data-testid="caixa-sem-marco">Ainda não há aporte nem retirada: o saldo soma tudo. Lance o seu saldo de abertura como um aporte para começar a contar dali.</div>

    <CampoBusca v-model="busca" placeholder="Buscar no extrato (cliente, despesa, aparelho)" rotulo="Buscar no extrato" />
    <div class="card list" data-testid="caixa-extrato">
      <component
        :is="m.manualId !== null ? 'button' : 'div'" v-for="m in itens" :key="m.chave" class="li" :data-movimento="m.chave" :data-categoria="m.categoria" :type="m.manualId !== null ? 'button' : undefined"
        :aria-label="m.manualId !== null ? `Corrigir ${m.titulo}` : undefined" @click="editar(m)"
      >
        <span class="wa" :style="`width: 32px; height: 32px; ${m.entrada ? '' : 'background: var(--bad-soft); color: var(--bad)'}`"><Icon :name="ICONE[m.categoria]" small /></span>
        <span class="mid"><span class="t" style="display: block">{{ m.titulo }}</span><span class="s" style="display: block">{{ dmy(m.data) }}{{ m.sub ? ` · ${m.sub}` : '' }}</span></span>
        <b class="num" style="white-space: nowrap" :style="{ color: m.entrada ? 'var(--ok)' : 'var(--bad)' }">{{ m.entrada ? '+' : '−' }} {{ fmt(m.valor) }}</b>
      </component>
      <div v-if="!itens.length && !carregando" class="empty">{{ busca.trim() ? 'Nada no extrato com essa busca.' : 'Nada no caixa ainda.' }}</div>
    </div>
    <RestanteDaLista v-if="caixa" :mostrados="itens.length" :total="caixa.total" :carregando="carregando" :parado="!!erro" />
  </template>
  <div v-else-if="carregando" class="empty">Carregando…</div>

  <FecharCaixaSheet :aberto="fecharAberto" :ultimo="ultimo" @fechar="fecharAberto = false" @fechado="aposFechar" />
  <LancamentoCaixaForm :aberto="formAberto" :lancamento="editando" :lado-padrao="ladoDaAba" :fechado-ate="ultimo?.dia" @fechar="formAberto = false" @salvo="aposSalvar" @excluido="aposSalvar" />
</template>
