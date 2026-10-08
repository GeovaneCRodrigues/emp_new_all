import { ref } from 'vue'
import { recebimentosApi } from '@/api/recursos'
import type { Sessao } from '@/domain/escopo'

/** Quantas parcelas estão atrasadas (o número vermelho do menu). Atualiza ao entrar e depois de cada recebimento. */
const atrasadas = ref(0)

export function useAtrasadas() {
  return {
    atrasadas,
    async atualizar(s: Sessao) {
      if (s.perfil !== 'ADMIN' && s.perfil !== 'COBRADOR') { atrasadas.value = 0; return }
      try { atrasadas.value = (await recebimentosApi.cobrancas(s, { aba: 'atrasadas', limite: 1 })).contagens.atrasadas } catch { /* o número fica como estava */ }
    },
  }
}
