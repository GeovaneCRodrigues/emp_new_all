<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { RelatoriosDados } from '@/api/relatorios'
import { relatoriosApi } from '@/api/recursos'
import Abas from '@/components/Abas.vue'
import RelBarras from '@/components/RelBarras.vue'
import { useApp } from '@/composables/useApp'
import { mesLabel } from '@/domain/cronograma'
import { fmt, fmt0 } from '@/domain/format'
import { cenario, CENARIOS, lerPerdas, PERDAS_PADRAO, type Perdas } from '@/domain/previsao'

/** Relatórios da loja: sete visões do mesmo dinheiro (só o administrador). */
const { sessao } = useApp()

const ABAS = [
  { id: 'resumo', label: 'Resumo', icon: 'house' },
  { id: 'lucro', label: 'Investimento e lucro', icon: 'arrow-up-right' },
  { id: 'capital', label: 'Capital', icon: 'wallet' },
  { id: 'indicador', label: 'Por indicador', icon: 'users' },
  { id: 'mensal', label: 'Controle mensal', icon: 'calendar-days' },
  { id: 'previsao', label: 'Previsão', icon: 'chart-no-axes-combined' },
  { id: 'balancete', label: 'Balancete', icon: 'landmark' },
]
const aba = ref(lerAba())
function lerAba() { try { const a = sessionStorage.getItem('relAba'); return ABAS.some((x) => x.id === a) ? (a as string) : 'resumo' } catch { return 'resumo' } }
function mudar(v: string) { aba.value = v; try { sessionStorage.setItem('relAba', v) } catch { /* sem armazenamento: só não lembra */ } }

const r = ref<RelatoriosDados | null>(null)
const carregando = ref(true)
const erro = ref('')
async function carregar() {
  carregando.value = true; erro.value = ''
  try { r.value = await relatoriosApi.ver(sessao.value) } catch (e) { erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar os relatórios.' } finally { carregando.value = false }
}
onMounted(carregar)

// Previsão: as perdas esperadas são suposição sua; ficam salvas neste navegador e dá para voltar ao padrão.
const CHAVE_PERDAS = 'relPerdas'
function perdasSalvas(): Perdas { try { return lerPerdas(JSON.parse(localStorage.getItem(CHAVE_PERDAS) ?? 'null')) } catch { return { ...PERDAS_PADRAO } } }
/** Fração (0,025) → o que aparece no campo (2,5): sem arredondar para inteiro, senão 2,5% voltaria como 3% ao recarregar. */
const emPct = (v: number) => Math.round(v * 10000) / 100
const perdasPct = reactive<Record<keyof Perdas, number>>((() => { const p = perdasSalvas(); return { aVencer: emPct(p.aVencer), ate7: emPct(p.ate7), de8a30: emPct(p.de8a30), mais30: emPct(p.mais30) } })())
// o que for digitado fora de 0 a 100 (ou vazio) é limitado a esse intervalo
// campo vazio ou sem sentido vale o padrão daquele grupo (nunca 0%, que seria o cenário mais otimista)
const fracao = (k: keyof Perdas) => { const v = perdasPct[k]; return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v / 100)) : PERDAS_PADRAO[k] }
const perdas = computed<Perdas>(() => ({ aVencer: fracao('aVencer'), ate7: fracao('ate7'), de8a30: fracao('de8a30'), mais30: fracao('mais30') }))
/** Ao sair do campo, ele mostra o que a conta realmente usa (900 vira 100, vazio volta ao padrão). */
function normalizar(k: keyof Perdas) { perdasPct[k] = emPct(fracao(k)) }
watch(perdas, (p) => { try { localStorage.setItem(CHAVE_PERDAS, JSON.stringify(p)) } catch { /* sem armazenamento: só não lembra */ } })
function voltarAoPadrao() { perdasPct.aVencer = emPct(PERDAS_PADRAO.aVencer); perdasPct.ate7 = emPct(PERDAS_PADRAO.ate7); perdasPct.de8a30 = emPct(PERDAS_PADRAO.de8a30); perdasPct.mais30 = emPct(PERDAS_PADRAO.mais30) }
const cenarios = computed(() => (r.value ? CENARIOS.map((c) => ({ ...c, ...cenario(r.value!.previsao, perdas.value, c.fator) })) : []))
const realista = computed(() => cenarios.value.find((c) => c.id === 'realista'))
const GRUPOS = [
  { id: 'ate7', rotulo: 'Atrasado até 7 dias' }, { id: 'de8a30', rotulo: 'Atrasado de 8 a 30 dias' }, { id: 'mais30', rotulo: 'Atrasado há mais de 30 dias' }, { id: 'aVencer', rotulo: 'Ainda a vencer' },
] as const
const grupoDaPrevisao = (id: (typeof GRUPOS)[number]['id']) => (id === 'aVencer' ? r.value!.previsao.aVencer : r.value!.previsao.atraso[id])
const esperadoDoGrupo = (id: (typeof GRUPOS)[number]['id']) => Math.round(grupoDaPrevisao(id).valor * (1 - perdas.value[id]) * 100) / 100

const pct = (v: number) => `${Math.round(v * 100)}%`
const totalLucro = computed(() => (r.value ? r.value.resumo.lucroIphones + r.value.resumo.lucroEmprestimos : 0))
const parteDoTotal = (v: number) => (totalLucro.value > 0 ? Math.round((v / totalLucro.value) * 100) : 0)
const tot = (k: 'investido' | 'recebido' | 'lucroNoBolso' | 'lucroPorVir') => (r.value ? r.value.investimentoELucro.iphones[k] + r.value.investimentoELucro.emprestimos[k] : 0)
const partesCapital = computed(() => {
  if (!r.value) return []
  const c = r.value.capital
  return [
    { l: 'Em caixa', v: c.emCaixa, c: 'var(--gold)' }, { l: 'No estoque', v: c.noEstoque, c: 'var(--dim)' },
    { l: 'Vendas na rua', v: c.vendasNaRua, c: 'var(--primary)' }, { l: 'Empréstimos na rua', v: c.emprestimosNaRua, c: 'var(--side)' },
  ]
})
const pctCapital = (v: number) => (r.value && r.value.capital.total > 0 ? Math.round((v / r.value.capital.total) * 100) : 0)
</script>

<template>
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar">Tentar de novo</button></div>
  <div v-if="carregando && !r" class="empty">Carregando…</div>

  <template v-if="r">
    <Abas :model-value="aba" :itens="ABAS" data-testid="rel-abas" @update:model-value="mudar" />

    <!-- Resumo -->
    <template v-if="aba === 'resumo'">
      <div class="card pad" data-testid="rel-resumo">
        <div class="between"><h2 style="margin: 0; font-size: 14px; color: var(--strong)">Seu lucro no bolso, por mês</h2><span class="small">depois do capital</span></div>
        <RelBarras :meses="r.resumo.meses" :series="[{ l: 'Seu lucro', v: r.resumo.lucroPorMes, c: 'var(--primary)' }]" :hoje="r.hoje" :alt="110" />
      </div>
      <div class="grid2">
        <div class="card pad"><div class="lbl">Lucro com iPhones</div><div class="val num" style="font-size: 18px; color: var(--ok)" data-testid="rel-lucro-iphones">{{ fmt0(r.resumo.lucroIphones) }}</div><div class="small">{{ parteDoTotal(r.resumo.lucroIphones) }}% do total</div></div>
        <div class="card pad"><div class="lbl">Lucro com empréstimos</div><div class="val num" style="font-size: 18px" data-testid="rel-lucro-emprestimos">{{ fmt0(r.resumo.lucroEmprestimos) }}</div><div class="small">{{ parteDoTotal(r.resumo.lucroEmprestimos) }}% do total</div></div>
      </div>
      <div class="card" data-testid="rel-modelos">
        <div class="totbar"><b style="color: var(--strong)">Modelos que mais vendem</b><span class="small">lucro médio · dias parado</span></div>
        <div class="list">
          <div v-for="m in r.resumo.modelos" :key="m.modelo" class="li" :data-modelo="m.modelo">
            <span class="mid t">{{ m.modelo }}</span><span class="small num">{{ m.vendas }} {{ m.vendas === 1 ? 'venda' : 'vendas' }}</span>
            <b class="num" style="width: 80px; text-align: right" :style="{ color: m.lucroMedio >= 0 ? 'var(--ok)' : 'var(--bad)' }">{{ fmt0(m.lucroMedio) }}</b>
            <span class="small num" style="width: 48px; text-align: right">{{ m.diasParado === null ? '—' : `${m.diasParado}d` }}</span>
          </div>
          <div v-if="!r.resumo.modelos.length" class="empty">Nenhuma venda ainda.</div>
        </div>
      </div>
    </template>

    <!-- Investimento e lucro -->
    <template v-else-if="aba === 'lucro'">
      <div class="card pad" data-testid="rel-lucro">
        <div class="between"><b style="color: var(--strong)">Dinheiro que saiu, voltou e virou lucro</b><span class="small">últimos 6 meses</span></div>
        <RelBarras :meses="r.investimentoELucro.meses" :hoje="r.hoje" :series="[{ l: 'Investido', v: r.investimentoELucro.investido, c: 'var(--dim)' }, { l: 'Recebido', v: r.investimentoELucro.recebido, c: 'var(--primary)' }, { l: 'Seu lucro', v: r.investimentoELucro.lucro, c: 'var(--gold)' }]" />
      </div>
      <div class="card">
        <div class="tab-x">
          <table class="tb">
            <thead><tr><th /><th class="r">Investido</th><th class="r">Recebido</th><th class="r">Lucro no bolso</th><th class="r">Lucro por vir</th><th class="r">Retorno</th></tr></thead>
            <tbody>
              <tr v-for="[nome, g, id] in ([['iPhones', r.investimentoELucro.iphones, 'iphones'], ['Empréstimos', r.investimentoELucro.emprestimos, 'emprestimos']] as const)" :key="id" :data-grupo="id">
                <td><b>{{ nome }}</b></td><td class="r num">{{ fmt0(g.investido) }}</td><td class="r num">{{ fmt0(g.recebido) }}</td><td class="r num" style="color: var(--ok)">{{ fmt0(g.lucroNoBolso) }}</td><td class="r num">{{ fmt0(g.lucroPorVir) }}</td><td class="r num">{{ pct(g.retorno) }}</td>
              </tr>
            </tbody>
            <tfoot><tr data-grupo="total"><td>Total</td><td class="r num">{{ fmt0(tot('investido')) }}</td><td class="r num">{{ fmt0(tot('recebido')) }}</td><td class="r num">{{ fmt0(tot('lucroNoBolso')) }}</td><td class="r num">{{ fmt0(tot('lucroPorVir')) }}</td><td /></tr></tfoot>
          </table>
        </div>
      </div>
      <p class="small" style="margin: 0">Retorno = seu lucro total ÷ o que você investiu. Com indicador, conta só a sua parte. O lucro "no bolso" começa depois que o capital volta.</p>
    </template>

    <!-- Capital -->
    <template v-else-if="aba === 'capital'">
      <div class="card pad" style="display: flex; flex-direction: column; gap: 12px" data-testid="rel-capital">
        <div class="between"><b style="color: var(--strong)">Onde está seu capital hoje</b><b class="num" style="color: var(--strong)" data-testid="rel-capital-total">{{ fmt0(r.capital.total) }}</b></div>
        <div class="pilha"><i v-for="p in partesCapital" :key="p.l" :style="{ width: `${r.capital.total > 0 ? (p.v / r.capital.total) * 100 : 0}%`, background: p.c }" :title="p.l" /></div>
        <div class="list">
          <div v-for="p in partesCapital" :key="p.l" class="li" style="padding: 8px 0" :data-parte="p.l">
            <i style="width: 10px; height: 10px; border-radius: 3px; flex: none" :style="{ background: p.c }" /><span class="mid t">{{ p.l }}</span><span class="small num">{{ pctCapital(p.v) }}%</span><b class="num" style="width: 96px; text-align: right">{{ fmt0(p.v) }}</b>
          </div>
        </div>
      </div>
      <div class="card pad">
        <div class="between"><b style="color: var(--strong)">Capital colocado por mês</b><span class="small">iPhones comprados + empréstimos liberados</span></div>
        <RelBarras :meses="r.capital.meses" :hoje="r.hoje" :alt="110" :series="[{ l: 'Colocado', v: r.capital.colocadoPorMes, c: 'var(--primary)' }]" />
      </div>
    </template>

    <!-- Por indicador -->
    <template v-else-if="aba === 'indicador'">
      <div class="card" data-testid="rel-indicador">
        <div class="tab-x">
          <table class="tb">
            <thead><tr><th /><th class="r">Operações</th><th class="r">Capital na rua</th><th class="r">Lucro total</th><th class="r">Parte dele</th><th class="r">Sua parte</th></tr></thead>
            <tbody>
              <tr v-for="l in r.porIndicador" :key="l.indicadorId ?? 'direto'" :data-indicador="l.indicadorId ?? 'direto'">
                <td><b>{{ l.nome }}</b><span v-if="l.indicadorId === null" class="small"> (sem indicador)</span></td><td class="r num">{{ l.operacoes }}</td><td class="r num">{{ fmt0(l.capitalNaRua) }}</td><td class="r num">{{ fmt0(l.lucroTotal) }}</td><td class="r num">{{ fmt0(l.parteDele) }}</td><td class="r num" style="color: var(--ok)">{{ fmt0(l.suaParte) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p class="small" style="margin: 0">Lucro total = tudo que a operação rende acima do capital, contando o que ainda vai entrar.</p>
    </template>

    <!-- Controle mensal -->
    <template v-else-if="aba === 'mensal'">
      <div class="card pad" data-testid="rel-mensal">
        <div class="between"><b style="color: var(--strong)">Previsto x recebido</b><span class="small">pelo mês do vencimento</span></div>
        <RelBarras :meses="r.controleMensal.map((m) => m.mes)" :hoje="r.hoje" :series="[{ l: 'Previsto', v: r.controleMensal.map((m) => m.previsto), c: 'var(--border)' }, { l: 'Recebido', v: r.controleMensal.map((m) => m.recebido), c: 'var(--primary)' }, { l: 'Em atraso', v: r.controleMensal.map((m) => m.emAtraso), c: 'var(--bad)' }]" />
      </div>
      <div class="card" data-testid="rel-mensal-tabela">
        <div class="tab-x">
          <table class="tb">
            <thead><tr><th>Mês</th><th class="r">Previsto</th><th class="r">Recebido</th><th class="r">Em atraso</th><th class="r">Recebeu</th></tr></thead>
            <tbody>
              <tr v-for="m in r.controleMensal" :key="m.mes" :data-mes="m.mes">
                <td style="text-transform: capitalize">{{ mesLabel(m.mes) }}</td><td class="r num">{{ fmt0(m.previsto) }}</td><td class="r num">{{ fmt0(m.recebido) }}</td>
                <td class="r num" :style="m.emAtraso ? 'color: var(--bad)' : ''">{{ m.emAtraso ? fmt0(m.emAtraso) : '—' }}</td>
                <td class="r num">{{ m.mes > r.hoje.slice(0, 7) ? '—' : pct(m.recebido / Math.max(1, m.previsto)) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- Previsão -->
    <template v-else-if="aba === 'previsao' && realista">
      <div class="hero" style="gap: 6px" data-testid="rel-previsao">
        <div class="lbl">Estimativa realista na sua mão</div>
        <div class="big disp num" data-testid="prev-namao" :style="realista.naMao < 0 ? 'color: #ffd6cf' : ''">{{ fmt(realista.naMao) }}</div>
        <div class="lbl">de {{ fmt0(cenarios[0].naMao) }} (pessimista) a {{ fmt0(cenarios[2].naMao) }} (otimista), já descontados os indicadores</div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px" data-testid="prev-cenarios">
        <div v-for="c in cenarios" :key="c.id" class="card pad" :data-cenario="c.id">
          <div class="lbl">{{ c.rotulo }}</div><div class="val num" style="font-size: 17px" :style="c.id === 'realista' ? 'color: var(--ok)' : ''">{{ fmt0(c.naMao) }}</div><div class="small">perde {{ fmt0(c.perdido) }} de {{ fmt0(c.devido) }}</div>
        </div>
      </div>
      <div class="card" data-testid="prev-grupos">
        <div class="totbar"><b style="color: var(--strong)">O que ainda vai entrar</b><button class="btn b-ghost b-sm" data-testid="prev-padrao" @click="voltarAoPadrao">Voltar ao padrão</button></div>
        <div class="tab-x">
          <table class="tb">
            <thead><tr><th /><th class="r">Parcelas</th><th class="r">Devido</th><th class="r">Perda</th><th class="r">Esperado</th></tr></thead>
            <tbody>
              <tr v-for="g in GRUPOS" :key="g.id" :data-grupo="g.id">
                <td><b>{{ g.rotulo }}</b></td><td class="r num">{{ grupoDaPrevisao(g.id).n }}</td><td class="r num">{{ fmt0(grupoDaPrevisao(g.id).valor) }}</td>
                <td class="r"><span class="inp" style="display: inline-flex; width: 74px; height: 32px"><input v-model.number="perdasPct[g.id]" type="number" min="0" max="100" step="0.5" inputmode="decimal" @change="normalizar(g.id)" :aria-label="`Perda esperada: ${g.rotulo}, em %`" :data-testid="`prev-perda-${g.id}`" style="text-align: right" /></span> %</td>
                <td class="r num" :data-testid="`prev-esperado-${g.id}`">{{ fmt0(esperadoDoGrupo(g.id)) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="card pad" data-testid="prev-meses">
        <div class="between"><h2 style="margin: 0; font-size: 14px; color: var(--strong)">O que vence por mês</h2><span class="small">devido e esperado</span></div>
        <RelBarras :meses="r.previsao.porMes.map((m) => m.mes)" :hoje="r.hoje" :alt="110" :series="[{ l: 'Devido', v: realista.porMes.map((m) => m.valor), c: 'var(--dim)' }, { l: 'Esperado', v: realista.porMes.map((m) => m.esperado), c: 'var(--primary)' }]" />
      </div>
      <div class="card" data-testid="prev-conta">
        <div class="totbar"><b style="color: var(--strong)">Como chega nesse número (realista)</b></div>
        <div class="list">
          <div class="li" style="padding: 9px 14px"><span class="mid t">Caixa de hoje</span><b class="num">{{ fmt(r.previsao.caixa) }}</b></div>
          <div class="li" style="padding: 9px 14px"><span class="mid"><span class="t" style="display: block">+ Atraso que deve voltar</span><span class="s" style="display: block">já sem a perda</span></span><b class="num">{{ fmt(realista.recuperadoAtraso) }}</b></div>
          <div class="li" style="padding: 9px 14px"><span class="mid"><span class="t" style="display: block">+ O que vai vencer</span><span class="s" style="display: block">já sem a perda</span></span><b class="num">{{ fmt(realista.recuperadoAVencer) }}</b></div>
          <div class="li" style="padding: 9px 14px"><span class="mid"><span class="t" style="display: block">− Parte dos indicadores</span><span class="s" style="display: block">cai junto com a perda</span></span><b class="num" style="color: var(--bad)">{{ fmt(realista.indicadores) }}</b></div>
          <div class="li" style="padding: 9px 14px"><span class="mid"><span class="t" style="display: block">− Repasses a pagar</span><span class="s" style="display: block">já liberados</span></span><b class="num" style="color: var(--bad)">{{ fmt(r.previsao.repassesAPagar) }}</b></div>
          <div class="li" style="padding: 9px 14px; opacity: 0.75"><span class="mid"><span class="t" style="display: block">Estoque (fora da conta)</span><span class="s" style="display: block">pelo custo; vira dinheiro quando vender</span></span><b class="num">{{ fmt(r.previsao.estoque) }}</b></div>
        </div>
      </div>
      <p class="small" style="margin: 0">As perdas são suposições suas (começam em 5% a vencer, 10%, 30% e 70% no atraso); o pessimista dobra e o otimista corta pela metade. Só juros conta o capital, não os juros que ainda não venceram. A parte dos indicadores é estimada na mesma proporção do que entra.</p>
    </template>

    <!-- Balancete -->
    <template v-else>
      <div class="duo" data-testid="rel-balancete">
        <div class="card">
          <div class="totbar"><b style="color: var(--strong)">O que você tem</b><b class="num" style="color: var(--strong)" data-testid="rel-ativo">{{ fmt(r.balancete.ativo) }}</b></div>
          <div class="list">
            <div class="li" style="padding: 9px 14px"><span class="mid t">Caixa</span><b class="num" data-testid="rel-b-caixa">{{ fmt(r.balancete.caixa) }}</b></div>
            <div class="li" style="padding: 9px 14px"><span class="mid"><span class="t" style="display: block">Estoque</span><span class="s" style="display: block">pelo custo dos aparelhos</span></span><b class="num">{{ fmt(r.balancete.estoque) }}</b></div>
            <div class="li" style="padding: 9px 14px"><span class="mid"><span class="t" style="display: block">A receber de vendas</span><span class="s" style="display: block">parcelas em aberto</span></span><b class="num">{{ fmt(r.balancete.aReceberVendas) }}</b></div>
            <div class="li" style="padding: 9px 14px"><span class="mid"><span class="t" style="display: block">A receber de empréstimos</span><span class="s" style="display: block">parcelas em aberto{{ r.balancete.jurosPorVencer > 0 ? ' (só juros: capital e juros já vencidos)' : '' }}</span></span><b class="num" data-testid="rel-b-areceber-emp">{{ fmt(r.balancete.aReceberEmprestimos) }}</b></div>
            <div v-if="r.balancete.jurosPorVencer > 0" class="li" style="padding: 9px 14px; opacity: 0.75" data-testid="rel-juros-por-vencer"><span class="mid"><span class="t" style="display: block">Juros por vencer (só juros)</span><span class="s" style="display: block">não conta no total: o cliente pode quitar o capital antes</span></span><b class="num">{{ fmt(r.balancete.jurosPorVencer) }}</b></div>
          </div>
        </div>
        <div class="card">
          <div class="totbar"><b style="color: var(--strong)">O que você deve</b><b class="num" style="color: var(--bad)" data-testid="rel-passivo">{{ fmt(r.balancete.passivo) }}</b></div>
          <div class="list">
            <div class="li" style="padding: 9px 14px"><span class="mid"><span class="t" style="display: block">Repasses a pagar</span><span class="s" style="display: block">já liberados para os indicadores</span></span><b class="num">{{ fmt(r.balancete.repassesAPagar) }}</b></div>
            <div class="li" style="padding: 9px 14px"><span class="mid"><span class="t" style="display: block">Parte futura dos indicadores</span><span class="s" style="display: block">do que ainda vai entrar</span></span><b class="num">{{ fmt(r.balancete.parteFuturaIndicadores) }}</b></div>
          </div>
        </div>
      </div>
      <div class="hero" style="gap: 6px">
        <div class="lbl">Patrimônio do negócio</div>
        <div class="big disp num" data-testid="rel-patrimonio" :style="r.balancete.patrimonio < 0 ? 'color: #ffd6cf' : ''">{{ fmt(r.balancete.patrimonio) }}</div>
        <div class="lbl" data-testid="rel-aportes">Você colocou {{ fmt0(r.balancete.aportes) }} · <template v-if="r.balancete.patrimonio >= r.balancete.aportes">cresceu <b style="color: #d8f5c0">{{ fmt0(r.balancete.patrimonio - r.balancete.aportes) }}</b></template><template v-else>está <b style="color: #ffd6cf">{{ fmt0(r.balancete.aportes - r.balancete.patrimonio) }}</b> abaixo</template></div>
      </div>
      <p class="small" style="margin: 0">"A receber" soma o que as parcelas ainda vão render, juros incluídos; num só juros entram o capital e os juros já vencidos, e os juros dos meses futuros ficam à parte.</p>
    </template>
  </template>
</template>
