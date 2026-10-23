/** Lê o corpo JSON sem deixar "__proto__" virar propriedade (se algum código copiar o corpo para outro objeto, ele não polui o protótipo). */
export const lerJsonSeguro = (texto: string): unknown => JSON.parse(texto, (chave, valor) => (chave === '__proto__' ? undefined : valor))
