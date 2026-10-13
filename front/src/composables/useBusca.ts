import { onBeforeUnmount, ref, watch } from 'vue'

/**
 * Campo de busca que só dispara depois de uma pausa na digitação (300 ms), para não chamar o servidor a cada letra.
 * `aoBuscar` recebe o texto já sem espaços nas pontas ('' = sem busca).
 */
export function useBusca(aoBuscar: (texto: string) => void, ms = 300) {
  const busca = ref('')
  let espera: ReturnType<typeof setTimeout> | undefined
  watch(busca, (novo, antigo) => {
    clearTimeout(espera)
    if (novo.trim() === (antigo ?? '').trim()) return // só mudou espaço: a busca é a mesma
    espera = setTimeout(() => aoBuscar(novo.trim()), ms)
  })
  onBeforeUnmount(() => clearTimeout(espera))
  return { busca }
}
