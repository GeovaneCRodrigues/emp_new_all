<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { AprovacaoApi } from '@/api/aprovacoes'
import { ErroApi } from '@/api/clientes'
import type { PessoaApi } from '@/api/equipe'
import type { FechamentoApi } from '@/api/fechamentos'
import type { PropostaApi } from '@/api/propostas'
import type { AlvoApi, ReciboApi, RegistradoApi } from '@/api/recebimentos'
import { aprovacoesApi, equipeApi, fechamentosApi, propostasApi } from '@/api/recursos'
import DateField from '@/components/DateField.vue'
import Icon from '@/components/Icon.vue'
import ReciboSheet from '@/components/ReciboSheet.vue'
import ReceberSheet from '@/components/ReceberSheet.vue'
import Sheet from '@/components/Sheet.vue'
import { useApp } from '@/composables/useApp'
import { useToast } from '@/composables/useToast'
import { useEquipeBadge } from '@/composables/useEquipeBadge'
import { usePulso } from '@/composables/usePulso'
import { dmy, dmyA, fmt, iniciais } from '@/domain/format'

const { sessao } = useApp()
const { mostrar } = useToast()
const router = useRouter()
const { atualizar: atualizarBadge } = useEquipeBadge()

const pessoas = ref<PessoaApi[]>([])
const pedidos = ref<AprovacaoApi[]>([])
const fechamentos = ref<FechamentoApi[]>([])
const propostas = ref<PropostaApi[]>([])
const carregando = ref(true)
const erro = ref('')
const ocupado = ref<string | null>(null)

const recusando = ref<AprovacaoApi | null>(null)
const motivoRecusa = ref('')
const convidando = ref(false)
const convite = reactive({ nome: '', email: '', perfil: 'COBRADOR' as 'COBRADOR' | 'VENDEDOR', fone: '' })
const erroConvite = ref('')
const criado = ref<{ email: string; senhaTemporaria: string } | null>(null)

const msg = (e: unknown, padrao: string) => (e instanceof ErroApi ? e.message : padrao)

async function carregar(silencioso = false) {
  if (!silencioso) erro.value = ''
  try {
    const [p, a, f, pr] = await Promise.all([
      equipeApi.listar(sessao.value),
      aprovacoesApi.listar(sessao.value, { status: 'PENDENTE', limite: 50 }),
      fechamentosApi.listar(sessao.value, { status: 'PENDENTE', limite: 50 }),
      propostasApi.listar(sessao.value, { status: 'PENDENTE', limite: 50 }),
    ])
    pessoas.value = p; pedidos.value = a.itens; fechamentos.value = f.itens; propostas.value = pr.itens
    atualizarBadge(sessao.value)
  } catch (e) {
    if (!silencioso) erro.value = msg(e, 'Não consegui carregar a equipe.')
  } finally {
    carregando.value = false
  }
}
onMounted(() => carregar())
// pedido novo chega sozinho; não mexe na lista no meio de uma confirmação ou recusa
usePulso(() => { if (ocupado.value === null && !recusando.value && !convidando.value) return carregar(true) })

async function executar(chave: string, fn: () => Promise<unknown>, ok: string) {
  if (ocupado.value) return
  ocupado.value = chave
  try { await fn(); mostrar(ok); await carregar() }
  catch (e) { mostrar(msg(e, 'Algo deu errado. Tente de novo.')); await carregar() }
  finally { ocupado.value = null }
}

const aprovar = (p: AprovacaoApi) => executar(`a${p.id}`, () => aprovacoesApi.aprovar(sessao.value, p.id), p.tipo === 'RETOMADA' ? 'Aparelho retomado. Voltou pro estoque.' : p.tipo === 'ACORDO' ? 'Acordo feito.' : `Desconto de ${fmt(p.valor)} aprovado.`)
function recusar(p: AprovacaoApi) { recusando.value = p; motivoRecusa.value = '' }
async function confirmarRecusa() {
  const p = recusando.value
  if (!p) return
  recusando.value = null
  await executar(`r${p.id}`, () => aprovacoesApi.recusar(sessao.value, p.id, motivoRecusa.value.trim() || undefined), 'Pedido recusado.')
}
const conferir = (f: FechamentoApi) => executar(`c${f.id}`, () => fechamentosApi.conferir(sessao.value, f.id), 'Fechamento conferido.')
const reabrir = (f: FechamentoApi) => executar(`o${f.id}`, () => fechamentosApi.reabrir(sessao.value, f.id), `Dia de ${f.usuario.nome.split(' ')[0]} reaberto.`)
const alternar = (p: PessoaApi) => executar(`p${p.id}`, () => equipeApi.atualizar(sessao.value, p.id, { ativo: !p.ativo }), p.ativo ? `${p.nome.split(' ')[0]} não entra mais.` : `${p.nome.split(' ')[0]} voltou a entrar.`)

function abrirConvite() { Object.assign(convite, { nome: '', email: '', perfil: 'COBRADOR', fone: '' }); erroConvite.value = ''; criado.value = null; convidando.value = true }
async function convidar() {
  if (ocupado.value) return
  ocupado.value = 'convite'; erroConvite.value = ''
  try {
    const r = await equipeApi.convidar(sessao.value, { nome: convite.nome, email: convite.email, perfil: convite.perfil, fone: convite.fone || null })
    criado.value = { email: r.email, senhaTemporaria: r.senhaTemporaria }
    await carregar()
  } catch (e) {
    erroConvite.value = msg(e, 'Não consegui convidar.')
  } finally {
    ocupado.value = null
  }
}
async function copiar(t: string) {
  try { await navigator.clipboard.writeText(t); mostrar('Copiado.') } catch { mostrar('Não consegui copiar. Selecione e copie à mão.') }
}

const NOME_PERFIL = { ADMIN: 'Administrador', COBRADOR: 'Cobrador', VENDEDOR: 'Vendedor' } as const
// ---- aviso de baixa do indicador: confirmar vira recebimento (e o recibo sai); veio menos que a parcela, a loja decide o resto ----
const NOME_FORMA = { PIX: 'Pix', DINHEIRO: 'Dinheiro', CARTAO: 'Cartão' } as const
const reciboAberto = ref<ReciboApi | null>(null)
/** A marca "caiu na conta do indicador" de cada aviso de baixa: começa como o indicador marcou e a loja pode mudar */
const naConta = reactive<Record<number, boolean>>({})
const naContaDe = (p: AprovacaoApi) => naConta[p.id] ?? (p.baixa?.naContaDoIndicador === true)
const primeiroNome = (p: AprovacaoApi) => p.solicitante.nome.split(' ')[0]
const decidindo = ref<AprovacaoApi | null>(null)
const resto = ref<'FICA' | 'DESCONTO'>('FICA')
const novaData = ref('')
const erroBaixa = ref('')
const { hoje } = useApp()

async function confirmarBaixa(p: AprovacaoApi, decisao?: { resto: 'FICA' | 'DESCONTO'; novoVencimento?: string }) {
  if (ocupado.value) return
  ocupado.value = `a${p.id}`; erroBaixa.value = ''
  try {
    const r = await aprovacoesApi.aprovar(sessao.value, p.id, { ...(decisao ?? {}), naContaDoIndicador: naContaDe(p) })
    decidindo.value = null
    mostrar(`Baixa confirmada: ${fmt(p.valor)} de ${p.cliente.nome}.`)
    reciboAberto.value = r.recibo ?? null
    await carregar()
  } catch (e) {
    // veio menos que a parcela (ou a data do resto é obrigatória): pergunta o que fazer com o resto
    if (e instanceof ErroApi && (e.codigo === 'RESTO_OBRIGATORIO' || e.codigo === 'VENCIMENTO_INVALIDO')) {
      if (!decidindo.value) { decidindo.value = p; resto.value = 'FICA'; novaData.value = hoje.value }
      erroBaixa.value = decisao ? e.message : ''
    } else { mostrar(msg(e, 'Não consegui confirmar a baixa.')); await carregar() }
  } finally {
    ocupado.value = null
  }
}
// o indicador avisou que o cliente quitou: abre a quitação já com o valor calculado, e a loja ajusta o desconto
const alvoQuitacao = ref<{ tipo: AlvoApi; operacaoId: number; parcela: number; quitar: true; aviso: { id: number; data: string; forma: 'PIX' | 'DINHEIRO' | 'CARTAO'; valor: number; naConta: boolean; indicador: string } } | null>(null)
function conferirQuitacao(p: AprovacaoApi) {
  if (!p.baixa || p.parcela === null) return
  alvoQuitacao.value = { tipo: p.alvo, operacaoId: p.operacaoId, parcela: p.parcela, quitar: true, aviso: { id: p.id, data: p.baixa.data, forma: p.baixa.forma, valor: p.valor, naConta: naContaDe(p), indicador: primeiroNome(p) } }
}
async function aoQuitar(r: RegistradoApi) {
  alvoQuitacao.value = null
  mostrar(`Quitação confirmada: ${fmt(r.recibo.valor)} de ${r.recibo.cliente.nome}.`)
  reciboAberto.value = r.recibo
  await carregar()
}
const decidir = () => decidindo.value && confirmarBaixa(decidindo.value, resto.value === 'FICA' ? { resto: 'FICA', novoVencimento: novaData.value || undefined } : { resto: 'DESCONTO' })

const total = computed(() => pedidos.value.length + fechamentos.value.length + propostas.value.length)

// ---- propostas dos indicadores: a loja aceita (e lança a venda/empréstimo no nome dele) ou recusa ----
const recusandoProposta = ref<PropostaApi | null>(null)
const motivoProposta = ref('')
/** Abre a venda ou o empréstimo já com o cliente e o indicador preenchidos; quando a loja salva, a proposta é ligada a ele. */
function lancar(p: PropostaApi) {
  const q = new URLSearchParams({ proposta: String(p.id), cliente: String(p.cliente.id), indicador: String(p.indicador.id) })
  if (p.parcelas) q.set('n', String(p.parcelas))
  if (p.tipo === 'VENDA') {
    if (p.aparelho) q.set('bem', String(p.aparelho.id))
    router.push(`/vender?${q}`)
  } else {
    q.set('novo', 'emprestimo')
    if (p.valor) q.set('capital', String(p.valor))
    router.push(`/operacoes?${q}`)
  }
}
const soAceitar = (p: PropostaApi) => executar(`pa${p.id}`, () => propostasApi.aceitar(sessao.value, p.id), `Proposta de ${p.indicador.nome} aceita.`)
function recusarProposta(p: PropostaApi) { recusandoProposta.value = p; motivoProposta.value = '' }
async function confirmarRecusaProposta() {
  const p = recusandoProposta.value
  if (!p) return
  recusandoProposta.value = null
  await executar(`pr${p.id}`, () => propostasApi.recusar(sessao.value, p.id, { motivo: motivoProposta.value.trim() || undefined }), 'Proposta recusada.')
}
const textoProposta = (p: PropostaApi) => [p.tipo === 'VENDA' ? 'quer um iPhone' : 'quer um empréstimo', p.interesse, p.valor ? fmt(p.valor) : null, p.parcelas ? `em ${p.parcelas}x` : null].filter(Boolean).join(' · ')
</script>

<template>
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar()">Tentar de novo</button></div>
  <div v-if="carregando" class="card empty">Carregando…</div>

  <template v-else>
    <section data-testid="esperando">
      <h3 class="sec">Esperando você <span v-if="total" class="chip c-warn">{{ total }}</span></h3>
      <div v-if="!total" class="card empty">Nada esperando. Tudo em dia.</div>

      <div v-for="p in pedidos" :key="'p' + p.id" class="card pad item" data-testid="pedido">
        <div class="row" style="gap: 10px; align-items: flex-start">
          <span class="ini">{{ iniciais(p.solicitante.nome) }}</span>
          <div style="flex: 1; min-width: 0">
            <div v-if="p.tipo === 'BAIXA'" class="val" data-tipo="BAIXA">{{ p.solicitante.nome.split(' ')[0] }} avisou que {{ p.baixa?.quitou ? 'o cliente quitou tudo e recebeu' : 'recebeu' }} <span class="num">{{ fmt(p.valor) }}</span></div>
            <div v-else-if="p.tipo === 'RETOMADA'" class="val" data-tipo="RETOMADA">{{ p.solicitante.nome }} pede para <b>retomar</b> o {{ p.aparelho }}</div>
            <div v-else-if="p.tipo === 'ACORDO'" class="val" data-tipo="ACORDO">{{ p.solicitante.nome }} propõe um <b>acordo</b> de <span class="num">{{ fmt(p.valor) }}</span> em {{ p.acordo?.parcelas }}x</div>
            <div v-else class="val" data-tipo="DESCONTO">{{ p.solicitante.nome }} pede <span class="num">{{ fmt(p.valor) }}</span> de desconto</div>
            <div v-if="p.tipo === 'BAIXA' && p.baixa" class="small">{{ p.cliente.nome }} · {{ p.aparelho }} · parcela {{ p.parcela }}/{{ p.nParcelas }} · {{ NOME_FORMA[p.baixa.forma] }} em {{ dmyA(p.baixa.data) }}<template v-if="p.baixa.comprovante"> · comprovante {{ p.baixa.comprovante }}</template></div>
            <div v-else-if="p.tipo === 'RETOMADA'" class="small">{{ p.cliente.nome }} · {{ fmt(p.valor) }} em aberto · a venda sai das cobranças e o aparelho volta pro estoque</div>
            <div v-else-if="p.tipo === 'ACORDO'" class="small">{{ p.cliente.nome }} · {{ p.aparelho }} · hoje ele deve {{ fmt(p.acordo?.saldoNoPedido ?? 0) }} · 1ª parcela {{ p.acordo ? dmy(p.acordo.primeiraParcela) : '' }}</div>
            <div v-else class="small">{{ p.cliente.nome }} · {{ p.aparelho }} · parcela {{ p.parcela }}/{{ p.nParcelas }}</div>
            <div v-if="p.motivo" class="small" style="margin-top: 4px">“{{ p.motivo }}”</div>
          </div>
        </div>
        <label v-if="p.tipo === 'BAIXA'" class="between small" style="gap: 8px; margin-top: 8px; align-items: center">
          <span v-if="naContaDe(p)" data-testid="destino-conta"><b>O dinheiro ficou com {{ primeiroNome(p) }}</b> (vai para a conta corrente dele)</span>
          <span v-else data-testid="destino-conta"><b>O dinheiro caiu na conta da loja.</b> Marque só se {{ primeiroNome(p) }} ficou com ele.</span>
          <input type="checkbox" data-na-conta :checked="naContaDe(p)" @change="naConta[p.id] = ($event.target as HTMLInputElement).checked" />
        </label>
        <div class="row" style="gap: 8px; margin-top: 10px">
          <button class="btn b-ok" style="flex: 1" :disabled="!!ocupado" :data-confirmar="p.tipo === 'BAIXA' ? '' : undefined" @click="p.tipo === 'BAIXA' ? (p.baixa?.quitou ? conferirQuitacao(p) : confirmarBaixa(p)) : aprovar(p)">{{ p.tipo === 'BAIXA' ? (p.baixa?.quitou ? 'Conferir quitação' : 'Confirmar baixa') : 'Aprovar' }}</button>
          <button v-if="p.tipo === 'BAIXA' && p.baixa?.quitou" class="btn b-ghost" :disabled="!!ocupado" data-so-parcela @click="confirmarBaixa(p)">Só a parcela</button>
          <button class="btn b-out" style="flex: 1" :disabled="!!ocupado" @click="recusar(p)">Recusar</button>
        </div>
      </div>

      <div v-for="p in propostas" :key="'x' + p.id" class="card pad item" data-testid="proposta" :data-proposta="p.id">
        <div class="row" style="gap: 10px; align-items: flex-start">
          <span class="ini">{{ iniciais(p.indicador.nome) }}</span>
          <div style="flex: 1; min-width: 0">
            <div class="val"><b>{{ p.indicador.nome }}</b> indicou {{ p.cliente.nome }}</div>
            <div class="small">{{ textoProposta(p) }}</div>
            <div v-if="p.obs" class="small" style="margin-top: 4px">“{{ p.obs }}”</div>
          </div>
        </div>
        <div class="row" style="gap: 8px; margin-top: 10px">
          <button class="btn b-ok" style="flex: 2" :disabled="!!ocupado" data-lancar @click="lancar(p)">{{ p.tipo === 'VENDA' ? 'Aceitar e lançar venda' : 'Aceitar e lançar empréstimo' }}</button>
          <button class="btn b-out" style="flex: 1" :disabled="!!ocupado" data-recusar-proposta @click="recusarProposta(p)">Recusar</button>
        </div>
        <button class="btn b-ghost b-sm" style="margin-top: 6px" :disabled="!!ocupado" data-so-aceitar @click="soAceitar(p)">Só aceitar (lanço depois)</button>
      </div>

      <div v-for="f in fechamentos" :key="'f' + f.id" class="card pad item" data-testid="fechamento">
        <div class="row" style="gap: 10px; align-items: flex-start">
          <span class="ini">{{ iniciais(f.usuario.nome) }}</span>
          <div style="flex: 1; min-width: 0">
            <div class="val">{{ f.usuario.nome }} fechou o dia {{ dmy(f.data) }}</div>
            <div class="small num">{{ fmt(f.total) }} · dinheiro {{ fmt(f.totalDinheiro) }} · Pix {{ fmt(f.totalPix) }} · cartão {{ fmt(f.totalCartao) }}</div>
          </div>
        </div>
        <div class="row" style="gap: 8px; margin-top: 10px">
          <button class="btn b-ok" style="flex: 1" :disabled="!!ocupado" @click="conferir(f)">Conferido</button>
          <button class="btn b-out" style="flex: 1" :disabled="!!ocupado" @click="reabrir(f)">Reabrir</button>
        </div>
      </div>
    </section>

    <section data-testid="pessoas">
      <div class="row" style="justify-content: space-between"><h3 class="sec">Pessoas</h3><button class="btn b-pri" @click="abrirConvite"><Icon name="plus" small />Convidar</button></div>
      <div v-for="p in pessoas" :key="p.id" class="card pad item" :style="{ opacity: p.ativo ? 1 : 0.6 }" data-testid="pessoa">
        <div class="row" style="gap: 10px; align-items: flex-start">
          <span class="ini">{{ iniciais(p.nome) }}</span>
          <div style="flex: 1; min-width: 0">
            <div class="val">{{ p.nome }} <span class="chip c-neu">{{ NOME_PERFIL[p.perfil] }}</span><span v-if="!p.ativo" class="chip c-bad">sem acesso</span></div>
            <div class="small">{{ p.email }}</div>
            <div v-if="p.perfil === 'COBRADOR'" class="small num">{{ p.carteira }} clientes · {{ p.comAtraso }} com atraso · recebeu {{ fmt(p.recebidoNoMes) }} no mês<template v-if="p.pedidosPendentes"> · {{ p.pedidosPendentes }} pedido(s) esperando</template></div>
            <div v-else-if="p.perfil === 'VENDEDOR'" class="small num">{{ p.carteira }} clientes · {{ p.vendasNoMes }} venda(s) no mês</div>
          </div>
          <button v-if="p.perfil !== 'ADMIN'" class="btn b-ghost b-sm" :disabled="!!ocupado" @click="alternar(p)">{{ p.ativo ? 'Desativar' : 'Reativar' }}</button>
        </div>
      </div>
    </section>
  </template>

  <Sheet :aberto="recusando !== null" @fechar="recusando = null">
    <template v-if="recusando">
      <h3>{{ recusando.tipo === 'RETOMADA' ? 'Recusar a retomada?' : recusando.tipo === 'ACORDO' ? 'Recusar o acordo?' : `Recusar o pedido de ${fmt(recusando.valor)}?` }}</h3>
      <div class="small">{{ recusando.solicitante.nome }} · {{ recusando.cliente.nome }}</div>
      <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px" @submit.prevent="confirmarRecusa">
        <div class="field"><label for="mRecusa">Quer explicar o motivo? (opcional)</label><div class="inp"><input id="mRecusa" v-model="motivoRecusa" maxlength="500" placeholder="Ex.: margem apertada" /></div></div>
        <button class="btn b-bad b-block" type="submit">Recusar</button>
      </form>
    </template>
  </Sheet>

  <Sheet :aberto="decidindo !== null" @fechar="decidindo = null">
    <template v-if="decidindo">
      <h3>E o resto da parcela?</h3>
      <div class="small">{{ decidindo.solicitante.nome.split(' ')[0] }} recebeu {{ fmt(decidindo.valor) }} de {{ decidindo.cliente.nome }}, e a parcela {{ decidindo.parcela }} é maior que isso.</div>
      <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px" @submit.prevent="decidir">
        <div class="field">
          <label class="row" style="gap: 8px; cursor: pointer"><input v-model="resto" type="radio" value="FICA" name="resto" data-resto="FICA" />Fica devendo o resto</label>
          <div v-if="resto === 'FICA'" style="margin-top: 6px"><label for="rNovaData" class="small">Nova data do resto</label><DateField id="rNovaData" v-model="novaData" :min="hoje" /></div>
        </div>
        <label class="row" style="gap: 8px; cursor: pointer"><input v-model="resto" type="radio" value="DESCONTO" name="resto" data-resto="DESCONTO" />Perdoar o resto (desconto)</label>
        <div v-if="erroBaixa" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erroBaixa }}</div>
        <button class="btn b-ok b-block" type="submit" :disabled="!!ocupado">Confirmar baixa</button>
      </form>
    </template>
  </Sheet>
  <ReceberSheet :alvo="alvoQuitacao" @fechar="alvoQuitacao = null" @registrado="aoQuitar" />
  <ReciboSheet :recibo="reciboAberto" @fechar="reciboAberto = null" />

  <Sheet :aberto="recusandoProposta !== null" @fechar="recusandoProposta = null">
    <template v-if="recusandoProposta">
      <h3>Recusar a proposta?</h3>
      <div class="small">{{ recusandoProposta.indicador.nome }} · {{ recusandoProposta.cliente.nome }}</div>
      <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 14px" @submit.prevent="confirmarRecusaProposta">
        <div class="field"><label for="mRecusaProposta">Quer explicar o motivo? (opcional)</label><div class="inp"><input id="mRecusaProposta" v-model="motivoProposta" maxlength="300" placeholder="Ex.: sem renda comprovada" autocomplete="off" /></div><div class="small">O indicador vai ver o que você escrever aqui.</div></div>
        <button class="btn b-bad b-block" type="submit">Recusar proposta</button>
      </form>
    </template>
  </Sheet>

  <Sheet :aberto="convidando" @fechar="convidando = false">
    <template v-if="criado">
      <h3>Acesso criado</h3>
      <p class="small">Passe estes dados para a pessoa. A senha só aparece agora; no primeiro acesso ela escolhe uma nova.</p>
      <div class="card pad" style="margin-top: 12px; background: var(--elevated)" data-testid="senha-temporaria">
        <div class="lbl">E-mail</div><div class="val">{{ criado.email }}</div>
        <div class="lbl" style="margin-top: 8px">Senha temporária</div><div class="val mono">{{ criado.senhaTemporaria }}</div>
      </div>
      <div class="row" style="gap: 8px; margin-top: 14px"><button class="btn b-out" style="flex: 1" @click="copiar(criado.senhaTemporaria)">Copiar senha</button><button class="btn b-pri" style="flex: 1" @click="convidando = false">Pronto</button></div>
    </template>
    <template v-else>
      <h3>Convidar pessoa</h3>
      <form style="display: flex; flex-direction: column; gap: 14px; margin-top: 12px" novalidate @submit.prevent="convidar">
        <div class="field"><label for="cNome">Nome</label><div class="inp maiusc"><input id="cNome" v-model="convite.nome" autocomplete="off" /></div></div>
        <div class="field"><label for="cEmail">E-mail</label><div class="inp"><input id="cEmail" v-model="convite.email" type="email" autocomplete="off" /></div></div>
        <div class="field"><label for="cFone">Telefone (opcional)</label><div class="inp"><input id="cFone" v-model="convite.fone" inputmode="tel" placeholder="(11) 98812-4410" /></div></div>
        <div class="field"><label>Função</label><div class="pills"><button type="button" class="pill" :class="{ on: convite.perfil === 'COBRADOR' }" @click="convite.perfil = 'COBRADOR'">Cobrador</button><button type="button" class="pill" :class="{ on: convite.perfil === 'VENDEDOR' }" @click="convite.perfil = 'VENDEDOR'">Vendedor</button></div></div>
        <div v-if="erroConvite" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad)">{{ erroConvite }}</div>
        <button class="btn b-pri b-block" type="submit" :disabled="ocupado === 'convite'">{{ ocupado === 'convite' ? 'Criando…' : 'Criar acesso' }}</button>
      </form>
    </template>
  </Sheet>
</template>
