/** Chave pública do servidor (base64url) no formato que o navegador pede para se inscrever. */
export function chaveParaNavegador(base64url: string): Uint8Array {
  const preenchida = base64url + '='.repeat((4 - (base64url.length % 4)) % 4)
  const bruta = atob(preenchida.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bruta, (c) => c.charCodeAt(0))
}
