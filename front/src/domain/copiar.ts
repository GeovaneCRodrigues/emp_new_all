/**
 * Copia o texto para a área de transferência. Em página sem HTTPS o navegador não oferece `navigator.clipboard`,
 * então cai no método antigo (textarea + execCommand). Devolve false se nenhum dos dois funcionou.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(texto); return true }
  } catch { /* tenta o método antigo */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = texto
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position: fixed; top: 0; left: 0; opacity: 0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}
