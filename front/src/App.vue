<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import NovoSheet from '@/components/NovoSheet.vue'
import Sheet from '@/components/Sheet.vue'
import Toast from '@/components/Toast.vue'
import { useAtrasadas } from '@/composables/useAtrasadas'
import { SESSOES, definirSessao, useApp } from '@/composables/useApp'
import { modoDemo, useAuth } from '@/composables/useAuth'
import { iniciais } from '@/domain/format'
import type { Perfil } from '@/domain/types'
import { MENUS, TITULOS, type ItemMenu } from '@/layouts/menus'

const route = useRoute()
const router = useRouter()
const { sessao, d } = useApp()
const { atrasadas, atualizar: atualizarAtrasadas } = useAtrasadas()
const auth = useAuth()

const ehLogin = computed(() => route.path === '/login' || route.path === '/trocar-senha')

// quem entrou define o perfil da tela (no modo demonstração dá para trocar pela barra "Ver como")
watch(auth.usuario, () => { const s = auth.sessao(); if (s) definirSessao(s) }, { immediate: true })

async function sair() {
  await auth.sair()
  router.replace('/login')
}

const menu = computed(() => MENUS[sessao.value.perfil])
const secao = computed(() => (route.params.secao as string) || menu.value.inicio)
const titulo = computed(() => TITULOS[secao.value] ?? 'Mundo dos iPhones')
const fabSide = computed(() => menu.value.abas.find((a) => a.fab))
const maisAberto = ref(false)
const novoAberto = ref(false)

const PERFIS: { id: Perfil; label: string }[] = [
  { id: 'ADMIN', label: 'Admin' }, { id: 'INDICADOR', label: 'Indicador' }, { id: 'COBRADOR', label: 'Cobrador' }, { id: 'VENDEDOR', label: 'Vendedor' },
]

const nomeLogado = computed(() => {
  if (auth.usuario.value && !modoDemo) return auth.usuario.value.nome
  const s = sessao.value
  if (s.perfil === 'INDICADOR') return d.value?.indicadores[0]?.nome ?? 'Indicador'
  return d.value?.usuarios.find((u) => u.id === s.usuarioId)?.nome ?? 'Geovane Cataneo'
})

// o contador do menu vem do servidor (parcelas atrasadas) e é atualizado a cada recebimento
// (no sistema de verdade só depois de entrar: antes disso o servidor responderia 401)
watch([() => sessao.value, auth.usuario], ([s]) => { if (modoDemo || auth.usuario.value) atualizarAtrasadas(s) }, { immediate: true, deep: true })
const contador = (id: string) => (id === 'cobrancas' || id === 'cobranca' || id === 'hoje') && sessao.value.perfil !== 'INDICADOR' && atrasadas.value ? atrasadas.value : 0

const noMais = computed(() => !menu.value.abas.some((a) => a.id === secao.value))

function ir(id: string) {
  maisAberto.value = false
  // "Novo" não é uma tela: abre a escolha entre venda, empréstimo e só simular
  if (id === 'novo') { novoAberto.value = true; return }
  router.push('/' + id)
}
function trocarPerfil(p: Perfil) {
  sessao.value = SESSOES[p]
}
// quando troca de perfil, a tela atual pode não existir no menu novo
watch(() => sessao.value.perfil, () => router.push('/'))

/** O botão em destaque da lateral (Nova venda / Indicar) não repete na lista. */
const temNovo = computed(() => !!fabSide.value && sessao.value.perfil !== 'COBRADOR')
const lateralItens = computed<ItemMenu[]>(() => menu.value.lateral.filter((x) => !(temNovo.value && x.id === fabSide.value?.id)))
const maisItens = computed<ItemMenu[]>(() => menu.value.mais.filter((x) => !menu.value.lateral.some((l) => l.id === x.id)))
</script>

<template>
  <router-view v-if="ehLogin" />
  <div v-else class="stage">
    <div v-if="modoDemo" class="barra-dev">
      <span><b>Protótipo</b> · dados de exemplo</span>
      <span>Ver como</span>
      <span class="seg">
        <button v-for="p in PERFIS" :key="p.id" :class="{ on: sessao.perfil === p.id }" @click="trocarPerfil(p.id)">{{ p.label }}</button>
      </span>
    </div>

    <div class="app">
      <div class="shell">
        <aside class="side">
          <div class="marca">
            <span class="logo"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="6" y="2.5" width="12" height="19" rx="3.2" stroke="#fff" stroke-width="2" /><circle cx="12" cy="12" r="3.6" stroke="#b8e35a" stroke-width="1.6" /></svg></span>
            <span>Mundo dos<br /><em>iPhones</em></span>
          </div>
          <button v-if="temNovo && fabSide" class="novo" @click="ir(fabSide.id)"><Icon name="plus" />{{ sessao.perfil === 'INDICADOR' ? 'Indicar' : sessao.perfil === 'ADMIN' ? 'Novo' : 'Nova venda' }}</button>
          <button v-for="n in lateralItens" :key="n.id" class="item" :class="{ on: secao === n.id }" @click="ir(n.id)">
            <Icon :name="n.icon" />{{ n.label }}<span v-if="contador(n.id)" class="cnt">{{ contador(n.id) }}</span>
          </button>
          <template v-if="maisItens.length">
            <div class="titulo">Mais</div>
            <button v-for="n in maisItens" :key="n.id" class="item" :class="{ on: secao === n.id }" @click="ir(n.id)">
              <Icon :name="n.icon" />{{ n.label }}
            </button>
          </template>
          <div class="rod">
            <span class="avatar">{{ iniciais(nomeLogado) }}</span>
            <div style="flex: 1; min-width: 0"><div style="color: var(--strong); font-weight: 600">{{ nomeLogado.split(' ')[0] }}</div><div style="font-size: 11px; color: var(--dim)">{{ menu.nomePerfil }}</div></div>
            <button class="btn b-ghost b-sm" title="Sair" aria-label="Sair" @click="sair"><Icon name="log-out" small /></button>
          </div>
        </aside>

        <div class="main">
          <header class="top">
            <span class="logo logo-m"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="6" y="2.5" width="12" height="19" rx="3.2" stroke="#fff" stroke-width="2" /><circle cx="12" cy="12" r="3.6" stroke="#b8e35a" stroke-width="1.6" /></svg></span>
            <h1>{{ titulo }}</h1>
            <button v-if="secao === 'operacoes'" class="btn b-pri b-sm" @click="ir('vender')"><Icon name="plus" small />Venda</button>
            <button class="btn b-ghost b-sm sair-cel" title="Sair" aria-label="Sair" @click="sair"><Icon name="log-out" small /></button>
          </header>
          <div class="content"><router-view :key="sessao.perfil" /></div>
        </div>

        <nav class="tabs">
          <template v-for="a in menu.abas" :key="a.id">
            <button v-if="a.fab" class="vender" :class="{ on: secao === a.id }" @click="ir(a.id)"><span class="fab"><Icon :name="a.icon" /></span>{{ a.label }}</button>
            <button v-else :class="{ on: secao === a.id }" @click="ir(a.id)">
              <Icon :name="a.icon" />{{ a.label }}<span v-if="contador(a.id)" class="badge-dot">{{ contador(a.id) }}</span>
            </button>
          </template>
          <button v-if="menu.mais.length" :class="{ on: noMais }" @click="maisAberto = true"><Icon name="menu" />Mais</button>
        </nav>
      </div>
    </div>

    <NovoSheet :aberto="novoAberto" @fechar="novoAberto = false" />
    <Toast />
    <Sheet :aberto="maisAberto" @fechar="maisAberto = false">
      <h3>Mais</h3>
      <div class="list card" style="margin-top: 12px">
        <button v-for="n in menu.mais" :key="n.id" class="li" @click="ir(n.id)"><Icon :name="n.icon" /><span class="mid"><span class="t">{{ n.label }}</span></span></button>
      </div>
    </Sheet>
  </div>
</template>

<style>
/* no computador o botão "Sair" fica na lateral (.btn.sair-cel: precisa vencer o display do .btn, que carrega depois) */
@container (min-width: 880px) { .btn.sair-cel { display: none; } }
</style>
