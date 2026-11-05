import { computed, ref } from 'vue'
import type { NotificacaoApi } from '@/api/notificacoes'
import { notificacoesApi } from '@/api/recursos'
import type { Sessao } from '@/domain/escopo'

/** Os avisos do sino. Um só estado para o app inteiro; quem usa chama `atualizar` (a barra de cima faz isso a cada 30 s). */
const itens = ref<NotificacaoApi[]>([])
const naoLidas = ref(0)

export function useNotificacoes() {
  return {
    itens,
    naoLidas: computed(() => naoLidas.value),
    async atualizar(s: Sessao) {
      if (s.perfil !== 'ADMIN' && s.perfil !== 'COBRADOR') { itens.value = []; naoLidas.value = 0; return }
      try { const r = await notificacoesApi.listar(s); itens.value = r.itens; naoLidas.value = r.naoLidas } catch { /* fica como estava */ }
    },
    async marcarLida(s: Sessao, id: number) {
      const n = itens.value.find((x) => x.id === id)
      if (!n || n.lida) return
      n.lida = true; naoLidas.value = Math.max(0, naoLidas.value - 1) // na hora; se falhar, a próxima atualização corrige
      try { await notificacoesApi.marcarLida(s, id) } catch { /* idem */ }
    },
    async marcarTodas(s: Sessao) {
      for (const n of itens.value) n.lida = true
      naoLidas.value = 0
      try { await notificacoesApi.marcarTodas(s) } catch { /* idem */ }
    },
    /** Ao sair da conta ninguém deve ver os avisos do outro. */
    limpar() { itens.value = []; naoLidas.value = 0 },
  }
}
