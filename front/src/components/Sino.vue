<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import type { NotificacaoApi } from '@/api/notificacoes'
import { useApp } from '@/composables/useApp'
import { useNotificacoes } from '@/composables/useNotificacoes'
import { tempoRelativo } from '@/domain/tempoRelativo'
import Icon from './Icon.vue'
import Sheet from './Sheet.vue'

/** O sino do alto da tela: contador de não lidas e a lista de avisos. Quem atualiza os dados é o App (a cada 30 s). */
const router = useRouter()
const { sessao } = useApp()
const { itens, naoLidas, marcarLida, marcarTodas } = useNotificacoes()
const aberto = ref(false)

function abrir(n: NotificacaoApi) {
  void marcarLida(sessao.value, n.id)
  aberto.value = false
  if (n.rota) void router.push(n.rota)
}
</script>

<template>
  <button class="sino" type="button" :aria-label="naoLidas ? `Avisos, ${naoLidas} não lidos` : 'Avisos'" data-testid="sino" @click="aberto = true">
    <Icon name="bell" />
    <span v-if="naoLidas" class="sino-n" data-testid="sino-contador">{{ naoLidas > 99 ? '99+' : naoLidas }}</span>
  </button>

  <Sheet :aberto="aberto" @fechar="aberto = false">
    <div class="row" style="justify-content: space-between; align-items: center; gap: 8px">
      <h3 style="margin: 0">Avisos</h3>
      <button v-if="naoLidas" class="btn b-ghost b-sm" type="button" data-testid="sino-todas" @click="marcarTodas(sessao)"><Icon name="check" small />Marcar todas como lidas</button>
    </div>
    <div v-if="itens.length === 0" class="small" style="margin-top: 14px" data-testid="sino-vazio">Nada por aqui. Os avisos de contrato assinado, pagamento, pedidos e atrasos aparecem neste lugar.</div>
    <ul v-else class="avisos" data-testid="sino-lista">
      <li v-for="n in itens" :key="n.id">
        <button type="button" class="aviso-item" :class="{ nova: !n.lida }" :data-nova="!n.lida" @click="abrir(n)">
          <span class="ponto" aria-hidden="true" />
          <span class="corpo"><span class="txt">{{ n.texto }}</span><span class="quando">{{ tempoRelativo(n.criadaEm) }}</span></span>
          <Icon v-if="n.rota" name="chevron-right" small />
        </button>
      </li>
    </ul>
  </Sheet>
</template>

<style scoped>
.sino { position: relative; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; color: var(--strong); background: transparent; border: 0; cursor: pointer; }
.sino:hover { background: var(--primary-soft); }
.sino-n { position: absolute; top: 0; right: 0; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 9px; background: var(--bad); color: #fff; font-size: 10px; font-weight: 600; line-height: 17px; text-align: center; box-shadow: 0 0 0 2px var(--bg); }
.avisos { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 60vh; overflow: auto; }
.aviso-item { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); color: var(--text); text-align: left; cursor: pointer; font: inherit; }
.aviso-item.nova { background: var(--primary-soft); border-color: transparent; }
.ponto { width: 8px; height: 8px; border-radius: 50%; flex: none; background: transparent; }
.nova .ponto { background: var(--primary); }
.corpo { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.txt { font-size: 14px; color: var(--strong); }
.nova .txt { font-weight: 600; }
.quando { font-size: 11.5px; color: var(--dim); }
</style>
