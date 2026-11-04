import { ref } from 'vue'

/** Só aparece se a resposta demorar mais que isso (resposta rápida não pisca a tela). */
export const ATRASO_MS = 200
/** Depois de aparecer, fica pelo menos isso (para não sumir antes de dar para ler). */
export const MINIMO_MS = 350

const pendentes = ref(0)
const visivel = ref(false)
let esperando: ReturnType<typeof setTimeout> | undefined
let escondendo: ReturnType<typeof setTimeout> | undefined
let apareceuEm = 0

/**
 * O "enviando…" que trava a tela enquanto uma ação está indo para a API (evita clicar duas vezes).
 * `iniciar` devolve a função que encerra; várias ações ao mesmo tempo mantêm o aviso até a última terminar.
 */
export function useCarregando() {
  function iniciar(): () => void {
    pendentes.value++
    clearTimeout(escondendo)
    if (!visivel.value && pendentes.value === 1) {
      clearTimeout(esperando)
      esperando = setTimeout(() => { if (pendentes.value > 0) { visivel.value = true; apareceuEm = Date.now() } }, ATRASO_MS)
    }
    let encerrado = false
    return () => {
      if (encerrado) return
      encerrado = true
      pendentes.value = Math.max(0, pendentes.value - 1)
      if (pendentes.value > 0) return
      clearTimeout(esperando)
      if (!visivel.value) return
      const falta = Math.max(0, MINIMO_MS - (Date.now() - apareceuEm))
      escondendo = setTimeout(() => { if (pendentes.value === 0) visivel.value = false }, falta)
    }
  }
  /** Mostra o aviso enquanto a promessa não termina. */
  async function enquanto<T>(p: Promise<T>): Promise<T> {
    const fim = iniciar()
    try { return await p } finally { fim() }
  }
  return { visivel, iniciar, enquanto }
}
