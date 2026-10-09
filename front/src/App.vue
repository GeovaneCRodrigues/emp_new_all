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
import { useEquipeBadge } from '@/composables/useEquipeBadge'
import { GRUPOS_ADMIN, ITENS_ADMIN, MENUS, TITULOS, TITULOS_INDICADOR, type ItemMenu } from '@/layouts/menus'

const route = useRoute()
const router = useRouter()
const { sessao, d } = useApp()
const { atrasadas, atualizar: atualizarAtrasadas } = useAtrasadas()
const { pendentes: equipePendentes, atualizar: atualizarEquipe } = useEquipeBadge()
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
const titulo = computed(() => (sessao.value.perfil === 'INDICADOR' ? TITULOS_INDICADOR[secao.value] : undefined) ?? TITULOS[secao.value] ?? 'Mundo dos iPhones')
const fabSide = computed(() => menu.value.abas.find((a) => a.fab))
const maisAberto = ref(false)
const contaAberta = ref(false)
const ehAdmin = computed(() => sessao.value.perfil === 'ADMIN')
/** "Mais" do celular: os grupos, sem o que já está na barra de baixo. */
const gruposMais = computed(() => GRUPOS_ADMIN.map((g) => ({ titulo: g.titulo, itens: g.ids.filter((id) => !menu.value.abas.some((a) => a.id === id)).map((id) => ITENS_ADMIN[id]) })).filter((g) => g.itens.length))
const gruposLateral = computed(() => GRUPOS_ADMIN.map((g) => ({ titulo: g.titulo, itens: g.ids.map((id) => ITENS_ADMIN[id]) })))
const emailLogado = computed(() => (auth.usuario.value && !modoDemo ? auth.usuario.value.email : `${sessao.value.perfil.toLowerCase()}@demo.com`))
async function sairDaConta() { contaAberta.value = false; maisAberto.value = false; await sair() }
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
watch([() => sessao.value, auth.usuario], ([s]) => { if (modoDemo || auth.usuario.value) { atualizarAtrasadas(s); atualizarEquipe(s) } }, { immediate: true, deep: true })
const contador = (id: string) => {
  if (id === 'equipe') return equipePendentes.value
  return (id === 'cobrancas' || id === 'cobranca' || id === 'hoje') && sessao.value.perfil !== 'INDICADOR' && atrasadas.value ? atrasadas.value : 0
}

const noMais = computed(() => ehAdmin.value && !menu.value.abas.some((a) => a.id === secao.value))

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
          <!-- administrador: o menu em grupos; os outros perfis: a lista deles -->
          <template v-if="ehAdmin">
            <template v-for="g in gruposLateral" :key="g.titulo">
              <div class="titulo">{{ g.titulo }}</div>
              <button v-for="n in g.itens" :key="n.id" class="item" :class="{ on: secao === n.id }" :data-menu="n.id" @click="ir(n.id)">
                <Icon :name="n.icon" />{{ n.label }}<span v-if="contador(n.id)" class="cnt">{{ contador(n.id) }}</span>
              </button>
            </template>
            <button class="item" style="margin-top: auto" :class="{ on: secao === 'config' }" data-menu="config" @click="ir('config')"><Icon name="settings" />Configurações</button>
          </template>
          <template v-else>
            <button v-for="n in lateralItens" :key="n.id" class="item" :class="{ on: secao === n.id }" @click="ir(n.id)">
              <Icon :name="n.icon" />{{ n.label }}<span v-if="contador(n.id)" class="cnt">{{ contador(n.id) }}</span>
            </button>
            <template v-if="maisItens.length">
              <div class="titulo">Mais</div>
              <button v-for="n in maisItens" :key="n.id" class="item" :class="{ on: secao === n.id }" @click="ir(n.id)"><Icon :name="n.icon" />{{ n.label }}</button>
            </template>
            <button class="item sair" style="margin-top: auto" data-sair @click="sair"><Icon name="log-out" />Sair do sistema</button>
          </template>
          <div class="rod" style="margin-top: 8px">
            <span class="avatar">{{ iniciais(nomeLogado) }}</span>
            <div style="flex: 1; min-width: 0"><div style="color: var(--strong); font-weight: 600">{{ nomeLogado }}</div><div style="font-size: 11px; color: var(--dim)">{{ menu.nomePerfil }}</div></div>
            <button v-if="ehAdmin" class="btn b-ghost b-sm" title="Sair do sistema" aria-label="Sair do sistema" @click="sair"><Icon name="log-out" small /></button>
          </div>
        </aside>

        <div class="main">
          <header class="top">
            <span class="logo logo-m"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="6" y="2.5" width="12" height="19" rx="3.2" stroke="#fff" stroke-width="2" /><circle cx="12" cy="12" r="3.6" stroke="#b8e35a" stroke-width="1.6" /></svg></span>
            <h1>{{ titulo }}</h1>
            <button v-if="secao === 'operacoes'" class="btn b-pri b-sm" @click="ir('vender')"><Icon name="plus" small />Venda</button>
            <!-- celular: o administrador sai pelo "Mais"; os outros perfis, pela bolinha com as iniciais (Minha conta) -->
            <button v-if="!ehAdmin" class="conta-btn sair-cel" aria-label="Minha conta" @click="contaAberta = true">{{ iniciais(nomeLogado) }}</button>
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
          <button v-if="ehAdmin && menu.mais.length" :class="{ on: noMais }" @click="maisAberto = true"><Icon name="menu" />Mais</button>
        </nav>
      </div>
    </div>

    <NovoSheet :aberto="novoAberto" @fechar="novoAberto = false" />
    <Toast />
    <Sheet :aberto="maisAberto" @fechar="maisAberto = false">
      <h3>Mais</h3>
      <template v-for="g in gruposMais" :key="g.titulo">
        <div class="mais-grupo">{{ g.titulo }}</div>
        <div class="list card">
          <button v-for="n in g.itens" :key="n.id" class="li" :data-menu="n.id" @click="ir(n.id)">
            <Icon :name="n.icon" /><span class="mid"><span class="t">{{ n.label }}</span></span>
            <span v-if="contador(n.id)" class="cnt-mais">{{ contador(n.id) }}</span><Icon name="chevron-right" small />
          </button>
        </div>
      </template>
      <div class="list card" style="margin-top: 16px">
        <button class="li" data-menu="config" @click="ir('config')"><Icon name="settings" /><span class="mid"><span class="t">Configurações</span></span><Icon name="chevron-right" small /></button>
        <button class="li sair" data-sair @click="sairDaConta"><Icon name="log-out" /><span class="mid"><span class="t">Sair do sistema</span></span></button>
      </div>
    </Sheet>

    <Sheet :aberto="contaAberta" @fechar="contaAberta = false">
      <h3 class="sr-only">Minha conta</h3>
      <div class="row" style="gap: 14px; margin-top: 6px">
        <span class="conta-av">{{ iniciais(nomeLogado) }}</span>
        <div style="min-width: 0"><div class="val" style="font-size: 17px">{{ nomeLogado }}</div><div class="small">{{ menu.nomePerfil }} · {{ emailLogado }}</div></div>
      </div>
      <button class="btn b-bad b-block" style="margin-top: 16px" data-sair @click="sairDaConta"><Icon name="log-out" small />Sair do sistema</button>
    </Sheet>
  </div>
</template>

<style>
/* no computador o botão "Sair" fica na lateral (.btn.sair-cel: precisa vencer o display do .btn, que carrega depois) */
@container (min-width: 880px) { .btn.sair-cel { display: none; } }
</style>
