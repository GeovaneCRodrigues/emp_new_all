import { ref } from 'vue'
import { aprovacoesApi, fechamentosApi, propostasApi } from '@/api/recursos'
import type { Sessao } from '@/domain/escopo'

/** O número vermelho da Equipe (administrador): pedidos esperando resposta, fechamentos do dia para conferir e propostas dos indicadores. */
const pendentes = ref(0)

export function useEquipeBadge() {
  return {
    pendentes,
    async atualizar(s: Sessao) {
      if (s.perfil !== 'ADMIN') { pendentes.value = 0; return }
      try {
        const [a, f, p] = await Promise.all([aprovacoesApi.listar(s, { status: 'PENDENTE', limite: 1 }), fechamentosApi.listar(s, { status: 'PENDENTE', limite: 1 }), propostasApi.listar(s, { status: 'PENDENTE', limite: 1 })])
        pendentes.value = a.pendentes + f.pendentes + p.pendentes
      } catch { /* o número fica como estava */ }
    },
  }
}
