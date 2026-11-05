import { ref } from 'vue'

export interface Aviso { id: number; mensagem: string; acao?: { texto: string; executar: () => void | Promise<void> }; tipo?: 'ok' | 'erro' }

const aviso = ref<Aviso | null>(null)
let tempo: ReturnType<typeof setTimeout> | undefined

/** Aviso rápido no topo da tela, com uma ação opcional (ex.: "Desfazer"). */
export function useToast() {
  return {
    aviso,
    mostrar(mensagem: string, acao?: Aviso['acao'], duracaoMs = 8000, tipo?: Aviso['tipo']) {
      clearTimeout(tempo)
      const id = Date.now()
      aviso.value = { id, mensagem, acao, tipo }
      tempo = setTimeout(() => { if (aviso.value?.id === id) aviso.value = null }, duracaoMs)
    },
    /** O que deu certo (verde, some logo). */
    ok(mensagem: string) { this.mostrar(mensagem, undefined, 4000, 'ok') },
    /** O que deu errado (vermelho, fica mais tempo para dar para ler). */
    erro(mensagem: string) { this.mostrar(mensagem, undefined, 8000, 'erro') },
    fechar() { clearTimeout(tempo); aviso.value = null },
  }
}
