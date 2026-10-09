<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AprovacaoApi } from '@/api/aprovacoes'
import { ErroApi } from '@/api/clientes'
import { aprovacoesApi } from '@/api/recursos'
import { useApp } from '@/composables/useApp'
import { dmy, fmt } from '@/domain/format'

/** Os pedidos do cobrador: os que esperam o administrador e os já respondidos. */
const { sessao } = useApp()
const itens = ref<AprovacaoApi[]>([])
const carregando = ref(true)
const erro = ref('')

async function carregar() {
  erro.value = ''
  try { itens.value = (await aprovacoesApi.listar(sessao.value, { limite: 100 })).itens }
  catch (e) { erro.value = e instanceof ErroApi ? e.message : 'Não consegui carregar os pedidos.' }
  finally { carregando.value = false }
}
onMounted(carregar)

const esperando = computed(() => itens.value.filter((p) => p.status === 'PENDENTE'))
const respondidos = computed(() => itens.value.filter((p) => p.status !== 'PENDENTE'))

const titulo = (p: AprovacaoApi) => {
  if (p.tipo === 'RETOMADA') return `Retomar o ${p.aparelho}`
  if (p.tipo === 'ACORDO') return `Acordo de ${fmt(p.valor)} em ${p.acordo?.parcelas ?? '?'}x`
  return `Desconto de ${fmt(p.valor)}`
}
const detalhe = (p: AprovacaoApi) => (p.tipo === 'DESCONTO' ? `${p.cliente.nome} · ${p.aparelho} · parcela ${p.parcela}/${p.nParcelas}` : `${p.cliente.nome} · ${p.aparelho}`)
const dia = (iso: string) => dmy(iso.slice(0, 10))
const rotulo = { PENDENTE: 'esperando', APROVADO: 'aprovado', RECUSADO: 'recusado' } as const
const cor = { PENDENTE: 'c-warn', APROVADO: 'c-ok', RECUSADO: 'c-bad' } as const
</script>

<template>
  <div v-if="erro" class="aviso" role="alert" style="background: var(--bad-soft); color: var(--bad); justify-content: space-between"><span>{{ erro }}</span><button class="btn b-ghost b-sm" @click="carregar">Tentar de novo</button></div>
  <div v-if="carregando" class="card empty">Carregando…</div>
  <template v-else>
    <div class="sec-t"><h2>Esperando o administrador</h2><span class="small">{{ esperando.length }}</span></div>
    <div class="card list" data-testid="pedidos-esperando">
      <div v-for="p in esperando" :key="p.id" class="li" style="cursor: default" :data-pedido="p.id">
        <div class="mid"><div class="t">{{ titulo(p) }}</div><div class="s">{{ detalhe(p) }} · pedido em {{ dia(p.criadaEm) }}</div><div v-if="p.motivo" class="s">“{{ p.motivo }}”</div></div>
        <span class="chip" :class="cor[p.status]">{{ rotulo[p.status] }}</span>
      </div>
      <div v-if="!esperando.length" class="empty">Nenhum pedido esperando.</div>
    </div>

    <div class="sec-t"><h2>Já respondidos</h2><span class="small">{{ respondidos.length }}</span></div>
    <div class="card list" data-testid="pedidos-respondidos">
      <div v-for="p in respondidos" :key="p.id" class="li" style="cursor: default" :data-pedido="p.id">
        <div class="mid">
          <div class="t">{{ titulo(p) }}</div>
          <div class="s">{{ detalhe(p) }}</div>
          <div class="s">{{ p.status === 'APROVADO' ? 'Aprovado' : 'Recusado' }} por {{ p.respondidoPor ?? 'o administrador' }}<template v-if="p.respondidoEm"> em {{ dia(p.respondidoEm) }}</template><template v-if="p.resposta"> · “{{ p.resposta }}”</template></div>
        </div>
        <span class="chip" :class="cor[p.status]">{{ rotulo[p.status] }}</span>
      </div>
      <div v-if="!respondidos.length" class="empty">Nenhum pedido respondido ainda.</div>
    </div>
  </template>
</template>
