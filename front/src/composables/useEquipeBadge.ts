import { ref } from 'vue'
import { aprovacoesApi, fechamentosApi } from '@/api/recursos'
import type { Sessao } from '@/domain/escopo'

/** O número vermelho da Equipe (administrador): pedidos esperando resposta mais fechamentos do dia para conferir. */
const pendentes = ref(0)

export function useEquipeBadge() {
  return {
    pendentes,
    async atualizar(s: Sessao) {
      if (s.perfil !== 'ADMIN') { pendentes.value = 0; return }
      try {
        const [a, f] = await Promise.all([aprovacoesApi.listar(s, { status: 'PENDENTE', limite: 1 }), fechamentosApi.listar(s, { status: 'PENDENTE', limite: 1 })])
        pendentes.value = a.pendentes + f.pendentes
      } catch { /* o número fica como estava */ }
    },
  }
}
