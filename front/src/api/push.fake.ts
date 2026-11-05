import type { PushApi } from './push'

/** Demonstração: o servidor de avisos não existe, então o botão nem aparece. */
export function criarPushFake(): PushApi {
  return {
    async config() { return { ligado: false, chavePublica: null } },
    async inscrever() {},
    async cancelar() {},
    async testar() {},
  }
}
