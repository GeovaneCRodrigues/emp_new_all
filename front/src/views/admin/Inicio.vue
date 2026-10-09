<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { AprovacaoApi } from '@/api/aprovacoes'
import { ErroApi } from '@/api/clientes'
import type { AparelhoApi } from '@/api/estoque'
import { todasAsPaginas } from '@/api/paginar'
import type { CobrancaApi } from '@/api/recebimentos'
import { aprovacoesApi, emprestimosApi, estoqueApi, fechamentosApi, recebimentosApi, vendasApi } from '@/api/recursos'
import CobrancaLinha from '@/components/CobrancaLinha.vue'
import FichasOperacao from '@/components/FichasOperacao.vue'
import Icon from '@/components/Icon.vue'
import MiniFone from '@/components/MiniFone.vue'
import { useApp } from '@/composables/useApp'
import { useAtrasadas } from '@/composables/useAtrasadas'
import { useEquipeBadge } from '@/composables/useEquipeBadge'
import { diasEntre } from '@/domain/datas'
import { fmt, fmt0 } from '@/domain/format'

/** O Início do administrador, com os números de verdade: o que cobrar hoje, o mês, o que espera por ele e o estoque parado. */
const router = useRouter()
const { sessao, hoje } = useApp()
const { atualizar: atualizarAtrasadas } = useAtrasadas()
const { atualizar: atualizarEquipe } = useEquipeBadge()
const fichas = ref<InstanceType<typeof FichasOperacao> | null>(null)

const atrasadas = ref<CobrancaApi[]>([])
const venceHoje = ref<CobrancaApi[]>([])
const aReceber = ref(0)
const vendasMes = ref({ n: 0, total: 0 })
const lucroRealizado = ref(0)
const pedidos = ref<AprovacaoApi[]>([])
const fechamentosPendentes = ref(0)
const parados = ref<{ a: AparelhoApi; dias: number }[]>([])
const carregando = ref(true)
const erro = ref('')

async function carregar() {
  erro.value = ''
  try {
    const s = sessao.value
    const mes = hoje.value.slice(0, 7)
    const [atr, hojeAba, resV, resE, vendas, emprestimos, ped, fech, disponiveis] = await Promise.all([
      recebimentosApi.cobrancas(s, { aba: 'atrasadas', limite: 100 }),
      recebimentosApi.cobrancas(s, { aba: 'hoje', limite: 100 }),
      vendasApi.resumo(s), emprestimosApi.resumo(s),
      todasAsPaginas((p) => vendasApi.listar(s, { pagina: p, limite: 100 })),
      todasAsPaginas((p) => emprestimosApi.listar(s, { pagina: p, limite: 100 })),
      aprovacoesApi.listar(s, { status: 'PENDENTE', limite: 100 }),
      fechamentosApi.listar(s, { status: 'PENDENTE', limite: 1 }),
      todasAsPaginas((p) => estoqueApi.listar(s, { estado: 'DISPONIVEL', pagina: p, limite: 100 })),
    ])
    atrasadas.value = atr.itens
    venceHoje.value = hojeAba.itens.filter((c) => c.vencimento === hoje.value)
    aReceber.value = Math.round((resV.aReceber + resE.aReceber) * 100) / 100
    const doMes = vendas.filter((v) => v.status !== 'CANCELADA' && v.dataVenda.slice(0, 7) === mes)
    vendasMes.value = { n: doMes.length, total: Math.round(doMes.reduce((x, v) => x + v.total, 0) * 100) / 100 }
    lucroRealizado.value = Math.round([...vendas, ...emprestimos].reduce((x, o) => x + (o.lucroRealizado ?? 0), 0) * 100) / 100
    pedidos.value = ped.itens
    fechamentosPendentes.value = fech.pendentes
    parados.value = disponiveis.map((a) => ({ a, dias: diasEntre(a.dataCompra, hoje.value) })).sort((x, y) => y.dias - x.dias).slice(0, 4)
    atualizarAtrasadas(s); atualizarEquipe(s)
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar o início.'
  } finally {
    carregando.value = false
  }
}
onMounted(carregar)

const soma = (l: CobrancaApi[]) => Math.round(l.reduce((x, c) => x + c.falta, 0) * 100) / 100
const cobrarHoje = computed(() => soma(atrasadas.value) + soma(venceHoje.value))
const NOME_TIPO = { DESCONTO: 'Desconto', RETOMADA: 'Retomada', ACORDO: 'Acordo', BAIXA: 'Baixa' } as const
const esperando = computed(() => {
  const tipos: string[] = [...new Set(pedidos.value.map((p) => NOME_TIPO[p.tipo]))]
  if (fechamentosPendentes.value) tipos.push('Fechamento')
  return { n: pedidos.value.length + fechamentosPendentes.value, tipos: tipos.join(', ') }
})
const chave = (c: CobrancaApi) => c.tipo + c.operacaoId + '-' + c.parcela
const custoDe = (a: AparelhoApi) => (a.custo ?? 0) + (a.extras ?? 0)
</script>

<template>
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar">Tentar de novo</button></div>
  <div class="inicio">
    <div class="col">
      <section class="hero">
        <div>
          <div class="lbl">Pra cobrar hoje</div>
          <div class="big disp num" data-testid="cobrar-hoje">{{ carregando ? '—' : fmt(cobrarHoje) }}</div>
          <div class="lbl" style="margin-top: 2px">{{ atrasadas.length }} atrasada{{ atrasadas.length === 1 ? '' : 's' }} · {{ venceHoje.length }} vence{{ venceHoje.length === 1 ? '' : 'm' }} hoje</div>
        </div>
        <div class="acts">
          <button class="btn gold" @click="router.push('/cobrancas')"><Icon name="hand-coins" small />Ver cobranças</button>
          <button class="btn" @click="router.push('/vender')"><Icon name="plus" small />Nova venda</button>
        </div>
      </section>

      <div class="kpis" data-testid="kpis">
        <button @click="router.push('/operacoes')">
          <div class="lbl">Vendas do mês</div><div class="val num" data-testid="vendas-mes">{{ vendasMes.n }}</div>
          <div class="small">{{ vendasMes.n ? fmt0(vendasMes.total) : 'nenhuma ainda' }}</div>
        </button>
        <div><div class="lbl">Lucro no bolso</div><div class="val num" style="color: var(--ok)" data-testid="lucro-bolso">{{ fmt0(lucroRealizado) }}</div><div class="small">já realizado</div></div>
        <button @click="router.push('/operacoes')">
          <div class="lbl">A receber</div><div class="val num" data-testid="a-receber">{{ fmt0(aReceber) }}</div><div class="small">vendas e empréstimos</div>
        </button>
      </div>

      <div class="sec-t"><h2>Atrasadas</h2><button @click="router.push('/cobrancas')">Ver todas</button></div>
      <div class="card list" data-testid="atrasadas">
        <CobrancaLinha v-for="c in atrasadas.slice(0, 5)" :key="chave(c)" :c="c" @abrir="fichas?.abrir(c.tipo, c.operacaoId)" @receber="fichas?.receber(c.tipo, c.operacaoId, c.parcela)" @recibo="fichas?.recibo($event)" />
        <div v-if="!atrasadas.length && !carregando" class="empty">Ninguém atrasado 🎉</div>
        <div v-if="carregando" class="empty">Carregando…</div>
      </div>
    </div>

    <div class="col">
      <div class="sec-t"><h2>Esperando você</h2></div>
      <div class="card list" data-testid="esperando-voce">
        <button v-if="esperando.n" class="li" data-esperando="equipe" @click="router.push('/equipe')">
          <span class="ico-amarelo"><Icon name="inbox" /></span>
          <div class="mid"><div class="t">{{ esperando.n }} {{ esperando.n === 1 ? 'pedido' : 'pedidos' }} da equipe</div><div class="s">{{ esperando.tipos }}</div></div>
          <Icon name="chevron-right" small />
        </button>
        <div v-else class="empty">Nada esperando. Tudo em dia.</div>
      </div>

      <div class="sec-t"><h2>Parado no estoque</h2><button @click="router.push('/estoque')">Estoque</button></div>
      <div class="card list" data-testid="parados">
        <button v-for="{ a, dias } in parados" :key="a.id" class="li" @click="router.push('/estoque')">
          <MiniFone :cor="a.cor" />
          <div class="mid"><div class="t">{{ a.modelo }} {{ a.gb }} GB</div><div class="s">{{ dias === 0 ? 'chegou hoje' : dias === 1 ? 'há 1 dia' : `há ${dias} dias` }} · custo {{ fmt0(custoDe(a)) }}</div></div>
          <b class="num">{{ fmt0(a.preco) }}</b>
        </button>
        <div v-if="!parados.length && !carregando" class="empty">Nenhum aparelho disponível.</div>
      </div>
    </div>
  </div>
  <FichasOperacao ref="fichas" @mudou="carregar" />
</template>
