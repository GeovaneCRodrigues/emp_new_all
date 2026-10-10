<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ErroApi } from '@/api/clientes'
import type { RelatoriosDados } from '@/api/relatorios'
import { relatoriosApi } from '@/api/recursos'
import Abas from '@/components/Abas.vue'
import RelBarras from '@/components/RelBarras.vue'
import { useApp } from '@/composables/useApp'
import { mesLabel } from '@/domain/cronograma'
import { fmt, fmt0 } from '@/domain/format'

/** Relatórios da loja: seis visões do mesmo dinheiro (só o administrador). */
const { sessao } = useApp()

const ABAS = [
  { id: 'resumo', label: 'Resumo', icon: 'house' },
  { id: 'lucro', label: 'Investimento e lucro', icon: 'arrow-up-right' },
  { id: 'capital', label: 'Capital', icon: 'wallet' },
  { id: 'indicador', label: 'Por indicador', icon: 'users' },
  { id: 'mensal', label: 'Controle mensal', icon: 'calendar-days' },
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

    <!-- Balancete -->
    <template v-else>
      <div class="duo" data-testid="rel-balancete">
        <div class="card">
          <div class="totbar"><b style="color: var(--strong)">O que você tem</b><b class="num" style="color: var(--strong)" data-testid="rel-ativo">{{ fmt(r.balancete.ativo) }}</b></div>
          <div class="list">
            <div class="li" style="padding: 9px 14px"><span class="mid t">Caixa</span><b class="num" data-testid="rel-b-caixa">{{ fmt(r.balancete.caixa) }}</b></div>
            <div class="li" style="padding: 9px 14px"><span class="mid"><span class="t" style="display: block">Estoque</span><span class="s" style="display: block">pelo custo dos aparelhos</span></span><b class="num">{{ fmt(r.balancete.estoque) }}</b></div>
            <div class="li" style="padding: 9px 14px"><span class="mid"><span class="t" style="display: block">A receber de vendas</span><span class="s" style="display: block">parcelas em aberto</span></span><b class="num">{{ fmt(r.balancete.aReceberVendas) }}</b></div>
            <div class="li" style="padding: 9px 14px"><span class="mid"><span class="t" style="display: block">A receber de empréstimos</span><span class="s" style="display: block">parcelas em aberto</span></span><b class="num">{{ fmt(r.balancete.aReceberEmprestimos) }}</b></div>
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
      <p class="small" style="margin: 0">"A receber" soma tudo que as parcelas ainda vão render, juros incluídos; num só juros isso inclui os meses futuros.</p>
    </template>
  </template>
</template>
