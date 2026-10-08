import { ref } from 'vue'

export interface Aviso { id: number; mensagem: string; acao?: { texto: string; executar: () => void | Promise<void> } }

const aviso = ref<Aviso | null>(null)
let tempo: ReturnType<typeof setTimeout> | undefined

/** Aviso rápido no topo da tela, com uma ação opcional (ex.: "Desfazer"). */
export function useToast() {
  return {
    aviso,
    mostrar(mensagem: string, acao?: Aviso['acao'], duracaoMs = 8000) {
      clearTimeout(tempo)
      const id = Date.now()
      aviso.value = { id, mensagem, acao }
      tempo = setTimeout(() => { if (aviso.value?.id === id) aviso.value = null }, duracaoMs)
    },
    fechar() { clearTimeout(tempo); aviso.value = null },
  }
}
