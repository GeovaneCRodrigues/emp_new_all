/** Lê o arquivo e devolve o conteúdo em base64 (sem o prefixo "data:"), em pedaços para não estourar a pilha. */
export async function emBase64(arquivo: Blob): Promise<string> {
  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/**
 * Foto de celular passa fácil de 5 MB: reduz para no máximo `lado` px e reenvia como JPEG.
 * PDF e imagens já pequenas seguem como estão. Se o navegador não conseguir, devolve o original.
 */
export async function prepararArquivo(f: File, lado = 2000, limite = 1.5 * 1024 * 1024): Promise<File> {
  if (!f.type.startsWith('image/') || f.size <= limite) return f
  try {
    const img = await createImageBitmap(f)
    const k = Math.min(1, lado / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.85))
    if (!blob || blob.size >= f.size) return f
    return new File([blob], f.name.replace(/\.[A-Za-z0-9]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch { return f }
}
